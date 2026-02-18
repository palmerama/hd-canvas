/**
 * PaperSize — Paper size definitions and DPI→pixel calculations
 *
 * Supports ISO A-series (A0–A6) and US sizes (Letter, Legal, Tabloid).
 * All dimensions stored in millimeters, converted to pixels via DPI.
 */

export interface PaperDimensions {
  /** Width in millimeters */
  readonly widthMM: number;
  /** Height in millimeters */
  readonly heightMM: number;
}

export interface PixelDimensions {
  readonly width: number;
  readonly height: number;
}

export type Orientation = 'portrait' | 'landscape';

/** Predefined paper size keys */
export type PaperSizeKey =
  | 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6'
  | 'Letter' | 'Legal' | 'Tabloid';

/**
 * Paper size registry — all dimensions in portrait orientation (width < height).
 * Millimeter values per ISO 216 and ANSI standards.
 */
export const PAPER_SIZES: Readonly<Record<PaperSizeKey, PaperDimensions>> = {
  // ISO A-series
  A0: { widthMM: 841, heightMM: 1189 },
  A1: { widthMM: 594, heightMM: 841 },
  A2: { widthMM: 420, heightMM: 594 },
  A3: { widthMM: 297, heightMM: 420 },
  A4: { widthMM: 210, heightMM: 297 },
  A5: { widthMM: 148, heightMM: 210 },
  A6: { widthMM: 105, heightMM: 148 },
  // US sizes (converted to mm)
  Letter:  { widthMM: 215.9, heightMM: 279.4 },
  Legal:   { widthMM: 215.9, heightMM: 355.6 },
  Tabloid: { widthMM: 279.4, heightMM: 431.8 },
} as const;

const MM_PER_INCH = 25.4;

/**
 * Convert paper dimensions + DPI to pixel dimensions.
 * Formula: pixels = (mm / 25.4) * dpi, rounded to nearest integer.
 */
export function sizeToPx(size: PaperDimensions, dpi: number): PixelDimensions {
  if (dpi <= 0) {
    throw new RangeError(`DPI must be positive, got ${dpi}`);
  }
  return {
    width: Math.round((size.widthMM / MM_PER_INCH) * dpi),
    height: Math.round((size.heightMM / MM_PER_INCH) * dpi),
  };
}

/**
 * Resolve a paper size input to millimeter dimensions, applying orientation.
 * Accepts either a predefined key or custom { widthMM, heightMM }.
 */
export function resolvePaperSize(
  size: PaperSizeKey | PaperDimensions,
  orientation: Orientation = 'portrait'
): PaperDimensions {
  const dims: PaperDimensions = typeof size === 'string' ? PAPER_SIZES[size] : size;

  if (dims.widthMM <= 0 || dims.heightMM <= 0) {
    throw new RangeError(
      `Paper dimensions must be positive, got ${dims.widthMM}×${dims.heightMM}mm`
    );
  }

  if (orientation === 'landscape') {
    return { widthMM: dims.heightMM, heightMM: dims.widthMM };
  }
  return dims;
}

/**
 * Estimate memory usage for a buffer at the given size, DPI, and color depth.
 * Returns size in bytes.
 */
export function estimateBufferBytes(
  size: PaperSizeKey | PaperDimensions,
  dpi: number,
  depth: 32 | 64 = 32
): number {
  const resolved = typeof size === 'string' ? PAPER_SIZES[size] : size;
  const px = sizeToPx(resolved, dpi);
  const bytesPerFloat = depth === 64 ? 8 : 4;
  return px.width * px.height * 4 * bytesPerFloat; // 4 channels (RGBA)
}
