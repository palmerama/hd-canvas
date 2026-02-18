/**
 * ExportPipeline — Wires ToneMapper + PNGExporter into HDCanvas.export()
 *
 * This is the integration layer. It creates the export function that
 * HDCanvas.setExportFn() expects, connecting the float buffer to the
 * tone mapping → PNG encoding → Blob pipeline.
 *
 * Usage:
 *   import { HDCanvas } from '../core/HDCanvas.js';
 *   import { attachExportPipeline } from './ExportPipeline.js';
 *
 *   const canvas = new HDCanvas({ paperSize: 'A3', dpi: 300 });
 *   attachExportPipeline(canvas);
 *
 *   // Now canvas.export() works:
 *   const blob = await canvas.export({ toneMap: 'aces', exposure: 1.2 });
 */

import { ToneMapper, type ToneMapAlgorithm } from './ToneMapper.js';
import { PNGExporter } from './PNGExporter.js';
import type { IColorBuffer } from '../core/ColorBuffer.js';

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Export options — matches the ExportOptions interface from HDCanvas.
 * We re-declare here to avoid importing from canvas-dev's code directly,
 * keeping the export pipeline decoupled.
 */
export interface ExportOptions {
  /** Tone mapping algorithm. Default: 'reinhard'. */
  toneMap?: 'reinhard' | 'aces' | 'clamp';
  /** Exposure adjustment in stops. Default: 0. */
  exposure?: number;
  /** Gamma correction. Default: 2.2 (sRGB). */
  gamma?: number;
  /** Output format. Default: 'png'. */
  format?: 'png';
}

/**
 * Progress callback for large exports.
 */
export type ExportProgressFn = (percent: number) => void;

/**
 * Extended export options with progress tracking.
 */
export interface ExportPipelineOptions extends ExportOptions {
  /** DPI for the output file metadata. */
  dpi: number;
  /** Progress callback. */
  onProgress?: ExportProgressFn;
}

// ─── Core export function ────────────────────────────────────────────

/**
 * Execute the full export pipeline: tone map → encode PNG → return Blob.
 *
 * This is the pure function that does the work. It takes a ColorBuffer
 * and options, returns a Blob. No side effects, no DOM dependency.
 */
export function exportBuffer(
  buffer: IColorBuffer,
  options: ExportPipelineOptions
): Blob {
  const {
    toneMap = 'reinhard',
    exposure = 0,
    gamma = 2.2,
    format = 'png',
    dpi,
    onProgress,
  } = options;

  if (format !== 'png') {
    throw new Error(`Unsupported export format: "${format}". Currently supported: png`);
  }

  // Step 1: Tone map (HDR float → 8-bit LDR)
  onProgress?.(0);

  const toneMapper = new ToneMapper({
    algorithm: toneMap as ToneMapAlgorithm,
    exposure,
    gamma,
    outputDepth: 8,
  });

  const ldrData = toneMapper.map(buffer);
  onProgress?.(50);

  // Step 2: Encode PNG with DPI metadata
  const pngExporter = new PNGExporter();
  const result = pngExporter.export(ldrData as Uint8Array, {
    width: buffer.width,
    height: buffer.height,
    dpi,
    depth: 8,
  });

  onProgress?.(90);

  // Step 3: Create Blob
  const blob = new Blob([result.data.buffer as ArrayBuffer], { type: 'image/png' });

  onProgress?.(100);

  return blob;
}

// ─── HDCanvas integration ────────────────────────────────────────────

/**
 * Minimal interface for the HDCanvas we need to attach to.
 * Avoids importing the full HDCanvas class — keeps coupling loose.
 */
export interface ExportableCanvas {
  readonly buffer: IColorBuffer;
  readonly dpi: number;
  setExportFn(fn: (buffer: IColorBuffer, options: ExportOptions) => Promise<Blob>): void;
}

/**
 * Attach the export pipeline to an HDCanvas instance.
 *
 * After calling this, `canvas.export()` will work:
 *   const blob = await canvas.export({ toneMap: 'aces', exposure: 1.2 });
 *
 * @param canvas - An HDCanvas instance (or anything matching ExportableCanvas)
 * @param onProgress - Optional progress callback for all exports
 */
export function attachExportPipeline(
  canvas: ExportableCanvas,
  onProgress?: ExportProgressFn
): void {
  canvas.setExportFn(async (buffer: IColorBuffer, options: ExportOptions): Promise<Blob> => {
    return exportBuffer(buffer, {
      ...options,
      dpi: canvas.dpi,
      onProgress,
    });
  });
}

// ─── Download helper ─────────────────────────────────────────────────

/**
 * Trigger a browser download of a Blob.
 *
 * Creates a temporary <a> element, clicks it, and cleans up.
 * Only works in browser environments with DOM access.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') {
    throw new Error('downloadBlob() requires a browser environment with DOM access');
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Clean up after a tick to ensure download starts
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 100);
}

/**
 * Generate a descriptive filename for an export.
 *
 * @example generateFilename(3508, 4961, 300) → "artwork-3508x4961-300dpi.png"
 */
export function generateFilename(
  width: number,
  height: number,
  dpi: number,
  prefix: string = 'artwork'
): string {
  return `${prefix}-${width}x${height}-${dpi}dpi.png`;
}

/**
 * Convenience: export an HDCanvas and trigger a browser download.
 *
 * @param canvas - HDCanvas with export pipeline attached
 * @param options - Export options (toneMap, exposure, gamma)
 * @param filename - Custom filename (auto-generated if omitted)
 */
export async function exportAndDownload(
  canvas: ExportableCanvas,
  options: ExportOptions = {},
  filename?: string
): Promise<void> {
  const blob = await exportBuffer(canvas.buffer, {
    ...options,
    dpi: canvas.dpi,
  });

  const name = filename ?? generateFilename(
    canvas.buffer.width,
    canvas.buffer.height,
    canvas.dpi
  );

  downloadBlob(blob, name);
}
