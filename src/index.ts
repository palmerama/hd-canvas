/**
 * HD Canvas Framework — Public API
 *
 * A reusable library for generative art with high dynamic range color,
 * configurable paper sizes, and print-quality export.
 */

// Core
export {
  ColorBuffer,
  type IColorBuffer,
  type ColorDepth,
  type BlendMode,
  type RGBA,
} from './core/ColorBuffer.js';

export {
  PAPER_SIZES,
  sizeToPx,
  resolvePaperSize,
  estimateBufferBytes,
  type PaperSizeKey,
  type PaperDimensions,
  type Orientation,
} from './core/PaperSize.js';

export {
  HDCanvas,
  type HDCanvasOptions,
  type ExportOptions,
} from './core/HDCanvas.js';

// Preview
export { PreviewRenderer, type PreviewRendererOptions } from './preview/PreviewRenderer.js';
export { calculateFit, type FitMode, type FitResult } from './preview/FitStrategy.js';

// Bridge
export { drawWith2D, type DrawWith2DOptions } from './bridge/Canvas2DBridge.js';

// Tone mapping
export {
  ToneMapper,
  clamp,
  reinhard,
  aces,
  TONE_MAP_ALGORITHMS,
  type ToneMapFn,
  type ToneMapAlgorithm,
  type ToneMapOptions,
  type OutputDepth,
} from './export/ToneMapper.js';

// PNG encoding
export {
  PNGExporter,
  dpiToPixelsPerMeter,
  injectPHYs,
  type PNGExportOptions,
  type PNGExportResult,
} from './export/PNGExporter.js';

// Export pipeline
export {
  exportBuffer,
  attachExportPipeline,
  downloadBlob,
  generateFilename,
  exportAndDownload,
  type ExportPipelineOptions,
  type ExportProgressFn,
  type ExportableCanvas,
} from './export/ExportPipeline.js';
