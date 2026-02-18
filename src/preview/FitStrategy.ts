/**
 * FitStrategy — Viewport fitting calculations
 *
 * Computes the display dimensions for a canvas within a container,
 * preserving aspect ratio.
 */

export type FitMode = 'contain' | 'cover';

export interface FitResult {
  /** Display width in CSS pixels */
  displayWidth: number;
  /** Display height in CSS pixels */
  displayHeight: number;
  /** Horizontal offset for centering (contain mode) */
  offsetX: number;
  /** Vertical offset for centering (contain mode) */
  offsetY: number;
  /** Scale factor from source to display */
  scale: number;
}

/**
 * Calculate how to fit a source rectangle into a container rectangle.
 *
 * - `contain`: Scale to fit entirely within container (letterbox)
 * - `cover`: Scale to fill container entirely (crop)
 */
export function calculateFit(
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
  mode: FitMode = 'contain'
): FitResult {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError(`Source dimensions must be positive: ${sourceWidth}×${sourceHeight}`);
  }
  if (containerWidth <= 0 || containerHeight <= 0) {
    throw new RangeError(`Container dimensions must be positive: ${containerWidth}×${containerHeight}`);
  }

  const scaleX = containerWidth / sourceWidth;
  const scaleY = containerHeight / sourceHeight;

  const scale = mode === 'contain'
    ? Math.min(scaleX, scaleY)
    : Math.max(scaleX, scaleY);

  const displayWidth = Math.round(sourceWidth * scale);
  const displayHeight = Math.round(sourceHeight * scale);

  const offsetX = Math.round((containerWidth - displayWidth) / 2);
  const offsetY = Math.round((containerHeight - displayHeight) / 2);

  return { displayWidth, displayHeight, offsetX, offsetY, scale };
}
