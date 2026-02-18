/**
 * Canvas2DBridge — Draw with the familiar Canvas 2D API into an HDR float buffer
 *
 * Creates a temporary offscreen canvas at full resolution (or tiled for large
 * formats), passes the 2D context to a user callback, reads back ImageData,
 * and writes into the ColorBuffer as float values (0–255 → 0.0–1.0).
 *
 * This is a one-way bridge: Canvas 2D → float buffer. The 2D context is 8-bit,
 * so this is for convenience shapes/text, not HDR input.
 */

import { ColorBuffer, type BlendMode } from '../core/ColorBuffer.js';

export interface DrawWith2DOptions {
  /** How to combine with existing buffer content. Default: 'overwrite' */
  mode?: 'overwrite' | 'blend';
  /** Blend mode when mode is 'blend'. Default: 'normal' */
  blendMode?: BlendMode;
  /** Region to draw into (default: full canvas). */
  region?: { x: number; y: number; width: number; height: number };
}

/**
 * Maximum tile dimension in pixels. Conservative to support all major browsers.
 * Chrome: ~16384, Firefox: ~11180, Safari: ~4096.
 * We use 4096 for maximum compatibility.
 */
const MAX_TILE_SIZE = 4096;

/**
 * Execute a Canvas 2D drawing callback and write the result into a ColorBuffer.
 *
 * For buffers larger than MAX_TILE_SIZE in either dimension, the drawing is
 * automatically tiled: the callback is invoked once per tile with the context
 * translated so the user draws in full-canvas coordinates.
 */
export function drawWith2D(
  buffer: ColorBuffer,
  callback: (ctx: CanvasRenderingContext2D) => void,
  options: DrawWith2DOptions = {}
): void {
  const mode = options.mode ?? 'overwrite';
  const blendMode = options.blendMode ?? 'normal';

  // Determine the target region
  const region = options.region ?? { x: 0, y: 0, width: buffer.width, height: buffer.height };

  validateRegion(region, buffer.width, buffer.height);

  const { x: rx, y: ry, width: rw, height: rh } = region;

  // Determine if we need tiling
  if (rw <= MAX_TILE_SIZE && rh <= MAX_TILE_SIZE) {
    // Single pass — no tiling needed
    drawTile(buffer, callback, rx, ry, rw, rh, mode, blendMode);
  } else {
    // Tiled rendering
    for (let ty = 0; ty < rh; ty += MAX_TILE_SIZE) {
      const tileH = Math.min(MAX_TILE_SIZE, rh - ty);
      for (let tx = 0; tx < rw; tx += MAX_TILE_SIZE) {
        const tileW = Math.min(MAX_TILE_SIZE, rw - tx);
        drawTile(
          buffer, callback,
          rx + tx, ry + ty,
          tileW, tileH,
          mode, blendMode
        );
      }
    }
  }
}

/**
 * Draw a single tile: create an offscreen canvas, invoke the callback with
 * a translated context, read back pixels, write into the buffer.
 */
function drawTile(
  buffer: ColorBuffer,
  callback: (ctx: CanvasRenderingContext2D) => void,
  tileX: number,
  tileY: number,
  tileW: number,
  tileH: number,
  mode: 'overwrite' | 'blend',
  blendMode: BlendMode
): void {
  // Create offscreen canvas for this tile
  const offscreen = document.createElement('canvas');
  offscreen.width = tileW;
  offscreen.height = tileH;

  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D rendering context for offscreen canvas');
  }

  // Translate so the user draws in full-canvas coordinates
  ctx.translate(-tileX, -tileY);

  // Clip to the tile region (prevents drawing outside tile bounds)
  ctx.beginPath();
  ctx.rect(tileX, tileY, tileW, tileH);
  ctx.clip();

  // Let the user draw
  callback(ctx);

  // Read back pixels
  const imageData = ctx.getImageData(0, 0, tileW, tileH);
  const pixels = imageData.data; // Uint8ClampedArray, RGBA

  // Write into the float buffer
  const inv255 = 1 / 255;

  if (mode === 'overwrite') {
    for (let row = 0; row < tileH; row++) {
      for (let col = 0; col < tileW; col++) {
        const srcIdx = (row * tileW + col) * 4;
        const r = pixels[srcIdx]! * inv255;
        const g = pixels[srcIdx + 1]! * inv255;
        const b = pixels[srcIdx + 2]! * inv255;
        const a = pixels[srcIdx + 3]! * inv255;
        buffer.setPixel(tileX + col, tileY + row, r, g, b, a);
      }
    }
  } else {
    // Blend mode — alpha composite onto existing content
    for (let row = 0; row < tileH; row++) {
      for (let col = 0; col < tileW; col++) {
        const srcIdx = (row * tileW + col) * 4;
        const r = pixels[srcIdx]! * inv255;
        const g = pixels[srcIdx + 1]! * inv255;
        const b = pixels[srcIdx + 2]! * inv255;
        const a = pixels[srcIdx + 3]! * inv255;

        // Skip fully transparent pixels (common optimization)
        if (a === 0) continue;

        buffer.blendPixel(tileX + col, tileY + row, r, g, b, a, blendMode);
      }
    }
  }

  // Clean up — remove references to allow GC
  offscreen.width = 0;
  offscreen.height = 0;
}

function validateRegion(
  region: { x: number; y: number; width: number; height: number },
  bufferWidth: number,
  bufferHeight: number
): void {
  const { x, y, width, height } = region;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    throw new RangeError(
      `Region must have non-negative origin and positive dimensions, got (${x},${y} ${width}×${height})`
    );
  }
  if (x + width > bufferWidth || y + height > bufferHeight) {
    throw new RangeError(
      `Region (${x},${y} ${width}×${height}) exceeds buffer bounds ${bufferWidth}×${bufferHeight}`
    );
  }
}

/** Exported for testing */
export const _internals = { MAX_TILE_SIZE };
