/**
 * HDCanvas — Main class for the HD Canvas framework
 *
 * Wires together ColorBuffer + PaperSize into a single API surface.
 * Construct with paper size + DPI, draw with float colors, preview on screen, export.
 */

import { ColorBuffer, type ColorDepth, type BlendMode, type RGBA } from './ColorBuffer.js';
import {
  type PaperSizeKey,
  type PaperDimensions,
  type Orientation,
  resolvePaperSize,
  sizeToPx,
} from './PaperSize.js';
import { drawWith2D, type DrawWith2DOptions } from '../bridge/Canvas2DBridge.js';

export interface HDCanvasOptions {
  /** Predefined paper size key or custom dimensions in mm */
  paperSize: PaperSizeKey | { widthMM: number; heightMM: number };
  /** Dots per inch — default 300 */
  dpi?: number;
  /** Float32 or Float64 color depth — default 32 */
  colorDepth?: ColorDepth;
  /** Portrait or landscape — default portrait */
  orientation?: Orientation;
}

export interface ExportOptions {
  /** Tone mapping algorithm */
  toneMap?: 'reinhard' | 'aces' | 'clamp';
  /** Exposure adjustment (stops) */
  exposure?: number;
  /** Gamma correction */
  gamma?: number;
  /** Output format */
  format?: 'png';
}

export class HDCanvas {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpi: number;
  readonly colorDepth: ColorDepth;
  readonly buffer: ColorBuffer;
  readonly paperMM: PaperDimensions;

  private previewRenderer: { refresh(): void; destroy(): void } | null = null;
  private exportFn: ((buffer: ColorBuffer, options: ExportOptions) => Promise<Blob>) | null = null;

  constructor(options: HDCanvasOptions) {
    const dpi = options.dpi ?? 300;
    const colorDepth = options.colorDepth ?? 32;
    const orientation = options.orientation ?? 'portrait';

    if (dpi <= 0) {
      throw new RangeError(`DPI must be positive, got ${dpi}`);
    }

    this.dpi = dpi;
    this.colorDepth = colorDepth;
    this.paperMM = resolvePaperSize(options.paperSize, orientation);

    const px = sizeToPx(this.paperMM, dpi);
    this.widthPx = px.width;
    this.heightPx = px.height;

    this.buffer = new ColorBuffer(this.widthPx, this.heightPx, colorDepth);
  }

  // --- Drawing API (delegates to ColorBuffer) ---

  setPixel(x: number, y: number, r: number, g: number, b: number, a?: number): void {
    this.buffer.setPixel(x, y, r, g, b, a);
  }

  getPixel(x: number, y: number): RGBA {
    return this.buffer.getPixel(x, y);
  }

  blendPixel(x: number, y: number, r: number, g: number, b: number, a: number, mode?: BlendMode): void {
    this.buffer.blendPixel(x, y, r, g, b, a, mode);
  }

  clear(r?: number, g?: number, b?: number, a?: number): void {
    this.buffer.clear(r, g, b, a);
  }

  getRegion(x: number, y: number, w: number, h: number): ColorBuffer {
    return this.buffer.getRegion(x, y, w, h);
  }

  putRegion(x: number, y: number, region: ColorBuffer): void {
    this.buffer.putRegion(x, y, region);
  }

  // --- Canvas 2D Bridge ---

  /**
   * Draw using the familiar Canvas 2D API. Creates a temporary offscreen canvas,
   * passes the 2D context to your callback, and reads pixels back into the float buffer.
   *
   * Note: Canvas 2D is 8-bit, so this is for convenience shapes/text, not HDR input.
   * For HDR drawing, use the pixel API directly.
   *
   * Automatically tiles for large canvases (A0+) to stay within browser limits.
   */
  drawWith2D(
    callback: (ctx: CanvasRenderingContext2D) => void,
    options?: DrawWith2DOptions
  ): void {
    drawWith2D(this.buffer, callback, options);
  }

  // --- Preview ---

  /**
   * Attach a preview renderer. The renderer is injected to avoid
   * coupling the core to DOM APIs (enables Node.js usage for headless export).
   */
  setPreviewRenderer(renderer: { refresh(): void; destroy(): void }): void {
    this.previewRenderer?.destroy();
    this.previewRenderer = renderer;
  }

  /** Trigger a preview refresh. No-op if no renderer attached. */
  refreshPreview(): void {
    this.previewRenderer?.refresh();
  }

  // --- Export ---

  /**
   * Register an export function. Injected to decouple core from export pipeline.
   */
  setExportFn(fn: (buffer: ColorBuffer, options: ExportOptions) => Promise<Blob>): void {
    this.exportFn = fn;
  }

  /** Export the canvas to a Blob. Requires an export function to be registered. */
  async export(options: ExportOptions = {}): Promise<Blob> {
    if (!this.exportFn) {
      throw new Error(
        'No export function registered. Call setExportFn() or use the export pipeline module.'
      );
    }
    return this.exportFn(this.buffer, options);
  }

  /** Estimated memory usage of the buffer in bytes */
  get memoryBytes(): number {
    return this.buffer.byteLength;
  }

  /** Clean up resources */
  destroy(): void {
    this.previewRenderer?.destroy();
    this.previewRenderer = null;
    this.exportFn = null;
  }
}
