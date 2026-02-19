/**
 * PreviewRenderer — HDR buffer → screen canvas with zoom & pan
 *
 * Creates a <canvas> inside a container, fitted to preserve paper aspect ratio.
 * Supports scroll-wheel zoom (centered on cursor), click-drag pan, keyboard
 * shortcuts, and only renders the visible region when zoomed for performance.
 */

import { type ColorBuffer } from '../core/ColorBuffer.js';
import { calculateFit, type FitMode } from './FitStrategy.js';

export interface PreviewRendererOptions {
  container: HTMLElement;
  buffer: ColorBuffer;
  fitMode?: FitMode;
  /** Minimum zoom: 'fit' means fit-to-container. Default: 'fit' */
  minZoom?: 'fit' | number;
  /** Maximum zoom multiplier relative to 1:1. Default: 4 (400%) */
  maxZoom?: number;
  /** Callback when zoom level changes */
  onZoomChange?: (zoomPercent: number) => void;
}

export interface OverlayCanvasOptions {
  /** CSS opacity (0–1). Default: 1 */
  opacity?: number;
  /** CSS mix-blend-mode. Default: 'normal' */
  blendMode?: string;
  /** Whether the overlay is visible. Default: true */
  visible?: boolean;
  /** CSS z-index for stacking order. Default: 1 */
  zIndex?: number;
}

/** Internal viewport state tracking zoom & pan */
interface ViewportState {
  /** Zoom scale: 1.0 = 1:1 pixel mapping between buffer and screen */
  zoom: number;
  /** Pan offset in buffer-pixel coordinates (top-left corner of visible region) */
  panX: number;
  panY: number;
}

/** Internal tracking for overlay canvases */
interface OverlayEntry {
  canvas: HTMLCanvasElement;
  options: Required<OverlayCanvasOptions>;
}

export class PreviewRenderer {
  private readonly container: HTMLElement;
  private readonly buffer: ColorBuffer;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fitMode: FitMode;
  private readonly maxZoom: number;
  private readonly onZoomChange?: (zoomPercent: number) => void;

  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;

  /** The scale at which the full buffer fits the container */
  private fitScale = 1;
  /** Current viewport state */
  private viewport: ViewportState = { zoom: 0, panX: 0, panY: 0 };

  /** Tracked overlay canvases */
  private overlays: OverlayEntry[] = [];

  // Drag state
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartPanX = 0;
  private dragStartPanY = 0;

  // Bound event handlers (for cleanup)
  private readonly handleWheel: (e: WheelEvent) => void;
  private readonly handleMouseDown: (e: MouseEvent) => void;
  private readonly handleMouseMove: (e: MouseEvent) => void;
  private readonly handleMouseUp: (e: MouseEvent) => void;
  private readonly handleDblClick: (e: MouseEvent) => void;
  private readonly handleKeyDown: (e: KeyboardEvent) => void;

  constructor(options: PreviewRendererOptions) {
    this.container = options.container;
    this.buffer = options.buffer;
    this.fitMode = options.fitMode ?? 'contain';
    this.maxZoom = options.maxZoom ?? 4;
    this.onZoomChange = options.onZoomChange;

    // Container must be positioned for absolute overlay children
    const pos = getComputedStyle(this.container).position;
    if (pos === 'static' || pos === '') {
      this.container.style.position = 'relative';
    }

    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.cursor = 'default';
    this.canvas.tabIndex = 0; // Make focusable for keyboard events
    this.canvas.style.outline = 'none';

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D rendering context');
    this.ctx = ctx;

    this.container.appendChild(this.canvas);

    // Compute initial fit
    this.recomputeFitScale();
    this.viewport.zoom = this.fitScale;

    // Bind event handlers
    this.handleWheel = this.onWheel.bind(this);
    this.handleMouseDown = this.onMouseDown.bind(this);
    this.handleMouseMove = this.onMouseMove.bind(this);
    this.handleMouseUp = this.onMouseUp.bind(this);
    this.handleDblClick = this.onDblClick.bind(this);
    this.handleKeyDown = this.onKeyDown.bind(this);

    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('dblclick', this.handleDblClick);
    this.canvas.addEventListener('keydown', this.handleKeyDown);

    // Observe container resizes
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.destroyed) {
        this.recomputeFitScale();
        this.clampViewport();
        this.repositionOverlays();
        this.refresh();
      }
    });
    this.resizeObserver.observe(this.container);

    this.refresh();
  }

  // --- Public API ---

  /** Current zoom as a percentage (100 = 1:1 pixel) */
  get zoomPercent(): number {
    return Math.round(this.viewport.zoom * 100);
  }

  /** Reset to fit-to-container view */
  fitToView(): void {
    this.recomputeFitScale();
    this.viewport.zoom = this.fitScale;
    this.viewport.panX = 0;
    this.viewport.panY = 0;
    this.updateCursor();
    this.emitZoomChange();
    this.refresh();
  }

  /** Programmatic zoom to a specific level (1.0 = 100%) */
  setZoom(zoom: number, centerX?: number, centerY?: number): void {
    this.applyZoom(zoom, centerX, centerY);
    this.refresh();
  }

  /**
   * Refresh the preview — reads the HDR buffer and renders the visible
   * region to the screen canvas.
   */
  refresh(): void {
    if (this.destroyed) return;

    // Keep overlays in sync with viewport on every refresh
    this.repositionOverlays();

    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;
    if (containerW <= 0 || containerH <= 0) return;

    // Canvas always fills the container
    if (this.canvas.width !== containerW || this.canvas.height !== containerH) {
      this.canvas.width = containerW;
      this.canvas.height = containerH;
    }

    this.ctx.clearRect(0, 0, containerW, containerH);

    const { zoom, panX, panY } = this.viewport;
    const bufW = this.buffer.width;
    const bufH = this.buffer.height;

    // Compute the visible region in buffer coordinates
    const visibleBufW = containerW / zoom;
    const visibleBufH = containerH / zoom;

    // Center the buffer in the viewport when it's smaller than the container
    const totalBufScreenW = bufW * zoom;
    const totalBufScreenH = bufH * zoom;
    const offsetScreenX = totalBufScreenW < containerW ? (containerW - totalBufScreenW) / 2 : 0;
    const offsetScreenY = totalBufScreenH < containerH ? (containerH - totalBufScreenH) / 2 : 0;

    // Source region (clamped to buffer bounds)
    const srcX0 = Math.max(0, Math.floor(panX));
    const srcY0 = Math.max(0, Math.floor(panY));
    const srcX1 = Math.min(bufW, Math.ceil(panX + visibleBufW));
    const srcY1 = Math.min(bufH, Math.ceil(panY + visibleBufH));
    const srcW = srcX1 - srcX0;
    const srcH = srcY1 - srcY0;

    if (srcW <= 0 || srcH <= 0) return;

    // Destination region on screen
    const dstX0 = Math.round((srcX0 - panX) * zoom + offsetScreenX);
    const dstY0 = Math.round((srcY0 - panY) * zoom + offsetScreenY);
    const dstW = Math.round(srcW * zoom);
    const dstH = Math.round(srcH * zoom);

    if (dstW <= 0 || dstH <= 0) return;

    // Render only the visible region
    const imageData = this.ctx.createImageData(dstW, dstH);
    const dst = imageData.data;
    const srcData = this.buffer.data;

    // Sample from buffer → screen pixels
    for (let dy = 0; dy < dstH; dy++) {
      // Map screen Y back to buffer Y
      const bufY = Math.min(srcY0 + (dy / zoom), srcY1 - 1);
      const sy = Math.floor(bufY);

      for (let dx = 0; dx < dstW; dx++) {
        const bufX = Math.min(srcX0 + (dx / zoom), srcX1 - 1);
        const sx = Math.floor(bufX);

        const srcIdx = (sy * bufW + sx) * 4;
        const dstIdx = (dy * dstW + dx) * 4;

        // Clamp tone map: [0,1] → [0,255]
        dst[dstIdx]     = Math.round(Math.max(0, Math.min(1, srcData[srcIdx]!)) * 255);
        dst[dstIdx + 1] = Math.round(Math.max(0, Math.min(1, srcData[srcIdx + 1]!)) * 255);
        dst[dstIdx + 2] = Math.round(Math.max(0, Math.min(1, srcData[srcIdx + 2]!)) * 255);
        dst[dstIdx + 3] = Math.round(Math.max(0, Math.min(1, srcData[srcIdx + 3]!)) * 255);
      }
    }

    this.ctx.putImageData(imageData, dstX0, dstY0);
  }

  // --- Overlay Canvas API ---

  /**
   * Create an overlay canvas positioned exactly over the buffer display area.
   *
   * The returned canvas is automatically sized and repositioned to match the
   * preview's viewport — including on container resize and zoom/pan changes.
   * Use it as a WebGL rendering surface, 2D drawing canvas, or anything else.
   *
   * The canvas `width` and `height` attributes are set to the display
   * dimensions (CSS pixels), giving 1:1 pixel mapping at the current zoom.
   *
   * @example
   * // WebGL overlay
   * const glCanvas = preview.createOverlayCanvas({ blendMode: 'screen' });
   * const renderer = new THREE.WebGLRenderer({ canvas: glCanvas });
   *
   * // 2D overlay
   * const canvas2d = preview.createOverlayCanvas({ opacity: 0.5 });
   * const ctx = canvas2d.getContext('2d');
   */
  createOverlayCanvas(options?: OverlayCanvasOptions): HTMLCanvasElement {
    if (this.destroyed) throw new Error('PreviewRenderer is destroyed');

    const resolved: Required<OverlayCanvasOptions> = {
      opacity: options?.opacity ?? 1,
      blendMode: options?.blendMode ?? 'normal',
      visible: options?.visible ?? true,
      zIndex: options?.zIndex ?? 1,
    };

    const overlay = document.createElement('canvas');
    overlay.style.position = 'absolute';
    overlay.style.pointerEvents = 'none';
    this.applyOverlayStyle(overlay, resolved);

    const entry: OverlayEntry = { canvas: overlay, options: resolved };
    this.overlays.push(entry);

    this.container.appendChild(overlay);
    this.positionOverlay(entry);

    return overlay;
  }

  /**
   * Update an overlay canvas's visual options after creation.
   * Throws if the canvas was not created by this PreviewRenderer.
   */
  updateOverlay(canvas: HTMLCanvasElement, options: Partial<OverlayCanvasOptions>): void {
    const entry = this.overlays.find(e => e.canvas === canvas);
    if (!entry) throw new Error('Canvas is not a tracked overlay');

    if (options.opacity !== undefined) entry.options.opacity = options.opacity;
    if (options.blendMode !== undefined) entry.options.blendMode = options.blendMode;
    if (options.visible !== undefined) entry.options.visible = options.visible;
    if (options.zIndex !== undefined) entry.options.zIndex = options.zIndex;

    this.applyOverlayStyle(entry.canvas, entry.options);
  }

  /**
   * Remove an overlay canvas and clean up.
   * Returns true if the canvas was found and removed, false otherwise.
   */
  removeOverlayCanvas(canvas: HTMLCanvasElement): boolean {
    const idx = this.overlays.findIndex(e => e.canvas === canvas);
    if (idx === -1) return false;

    this.overlays.splice(idx, 1);
    canvas.remove();
    return true;
  }

  destroy(): void {
    this.destroyed = true;

    // Clean up all overlays
    for (const entry of this.overlays) {
      entry.canvas.remove();
    }
    this.overlays.length = 0;

    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('dblclick', this.handleDblClick);
    this.canvas.removeEventListener('keydown', this.handleKeyDown);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas.remove();
  }

  // --- Private: zoom & pan logic ---

  private recomputeFitScale(): void {
    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;
    if (containerW <= 0 || containerH <= 0) return;

    const fit = calculateFit(
      this.buffer.width,
      this.buffer.height,
      containerW,
      containerH,
      this.fitMode
    );
    this.fitScale = fit.scale;
  }

  private applyZoom(newZoom: number, screenCenterX?: number, screenCenterY?: number): void {
    const minZoom = this.fitScale;
    const clamped = Math.max(minZoom, Math.min(this.maxZoom, newZoom));

    if (clamped === this.viewport.zoom) return;

    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;

    // Default center: middle of the container
    const cx = screenCenterX ?? containerW / 2;
    const cy = screenCenterY ?? containerH / 2;

    // Buffer coordinate under the cursor before zoom
    const bufX = this.viewport.panX + cx / this.viewport.zoom;
    const bufY = this.viewport.panY + cy / this.viewport.zoom;

    this.viewport.zoom = clamped;

    // Adjust pan so the same buffer point stays under the cursor
    this.viewport.panX = bufX - cx / clamped;
    this.viewport.panY = bufY - cy / clamped;

    this.clampViewport();
    this.updateCursor();
    this.emitZoomChange();
  }

  private clampViewport(): void {
    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;
    const bufW = this.buffer.width;
    const bufH = this.buffer.height;
    const { zoom } = this.viewport;

    const visibleBufW = containerW / zoom;
    const visibleBufH = containerH / zoom;

    // If the buffer fits entirely on screen, center it (pan = 0)
    if (visibleBufW >= bufW) {
      this.viewport.panX = 0;
    } else {
      this.viewport.panX = Math.max(0, Math.min(bufW - visibleBufW, this.viewport.panX));
    }

    if (visibleBufH >= bufH) {
      this.viewport.panY = 0;
    } else {
      this.viewport.panY = Math.max(0, Math.min(bufH - visibleBufH, this.viewport.panY));
    }
  }

  private updateCursor(): void {
    const isZoomed = this.viewport.zoom > this.fitScale * 1.01;
    this.canvas.style.cursor = isZoomed ? 'grab' : 'default';
  }

  private emitZoomChange(): void {
    this.onZoomChange?.(this.zoomPercent);
  }

  // --- Overlay positioning ---

  /**
   * Compute the current display rect for the buffer in container coordinates.
   * This is the exact region where buffer content appears on screen —
   * overlays are positioned to match this rect precisely.
   */
  private computeDisplayRect(): { x: number; y: number; w: number; h: number } {
    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;
    const { zoom, panX, panY } = this.viewport;
    const bufW = this.buffer.width;
    const bufH = this.buffer.height;

    const totalBufScreenW = bufW * zoom;
    const totalBufScreenH = bufH * zoom;
    const offsetScreenX = totalBufScreenW < containerW ? (containerW - totalBufScreenW) / 2 : 0;
    const offsetScreenY = totalBufScreenH < containerH ? (containerH - totalBufScreenH) / 2 : 0;

    return {
      x: Math.round(offsetScreenX - panX * zoom),
      y: Math.round(offsetScreenY - panY * zoom),
      w: Math.round(totalBufScreenW),
      h: Math.round(totalBufScreenH),
    };
  }

  /** Position a single overlay to match the current display rect */
  private positionOverlay(entry: OverlayEntry): void {
    const rect = this.computeDisplayRect();
    const { canvas } = entry;

    canvas.style.left = `${rect.x}px`;
    canvas.style.top = `${rect.y}px`;
    canvas.style.width = `${rect.w}px`;
    canvas.style.height = `${rect.h}px`;

    // Set canvas backing dimensions to match display size for 1:1 pixels.
    // Only update if changed — resizing a canvas clears its content.
    if (canvas.width !== rect.w || canvas.height !== rect.h) {
      canvas.width = rect.w;
      canvas.height = rect.h;
    }
  }

  /** Reposition all overlays (called on resize, zoom, pan) */
  private repositionOverlays(): void {
    for (const entry of this.overlays) {
      this.positionOverlay(entry);
    }
  }

  /** Apply visual style options to an overlay canvas */
  private applyOverlayStyle(canvas: HTMLCanvasElement, opts: Required<OverlayCanvasOptions>): void {
    canvas.style.opacity = String(opts.opacity);
    canvas.style.mixBlendMode = opts.blendMode;
    canvas.style.display = opts.visible ? 'block' : 'none';
    canvas.style.zIndex = String(opts.zIndex);
  }

  // --- Event handlers ---

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const rect = this.canvas.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    this.applyZoom(this.viewport.zoom * zoomFactor, cursorX, cursorY);
    this.refresh();
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // left click only
    const isZoomed = this.viewport.zoom > this.fitScale * 1.01;
    if (!isZoomed) return;

    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragStartPanX = this.viewport.panX;
    this.dragStartPanY = this.viewport.panY;
    this.canvas.style.cursor = 'grabbing';
    e.preventDefault();
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.dragging) return;

    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;

    // Convert screen delta to buffer delta
    this.viewport.panX = this.dragStartPanX - dx / this.viewport.zoom;
    this.viewport.panY = this.dragStartPanY - dy / this.viewport.zoom;
    this.clampViewport();
    this.refresh();
  }

  private onMouseUp(_e: MouseEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.updateCursor();
  }

  private onDblClick(_e: MouseEvent): void {
    this.fitToView();
  }

  private onKeyDown(e: KeyboardEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        this.applyZoom(this.viewport.zoom * 1.25, centerX, centerY);
        this.refresh();
        break;
      case '-':
        e.preventDefault();
        this.applyZoom(this.viewport.zoom / 1.25, centerX, centerY);
        this.refresh();
        break;
      case '0':
        e.preventDefault();
        this.fitToView();
        break;
    }
  }
}
