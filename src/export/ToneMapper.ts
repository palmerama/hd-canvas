/**
 * ToneMapper — HDR → LDR tone mapping with pluggable algorithms.
 *
 * Takes an HDR ColorBuffer (unbounded float RGBA) and produces a
 * quantized Uint8Array or Uint16Array suitable for image encoding.
 *
 * Pipeline per-pixel:
 *   1. Exposure: multiply RGB by 2^exposure
 *   2. Tone map: compress HDR range → [0, 1] using selected algorithm
 *   3. Gamma: apply gamma correction (output = value^(1/gamma))
 *   4. Quantize: float [0,1] → uint8 [0,255] or uint16 [0,65535]
 *
 * Alpha is passed through without tone mapping (clamped to [0,1]).
 */

import type { IColorBuffer } from '../core/ColorBuffer.js';

// ─── Algorithm definitions ───────────────────────────────────────────

/**
 * A tone mapping function. Takes an unbounded HDR luminance value (≥0)
 * and returns a value in [0, 1].
 */
export type ToneMapFn = (v: number) => number;

/** Simple clamp to [0, 1]. No compression — just clips. */
export function clamp(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Reinhard tone mapping: v / (1 + v).
 * Smoothly compresses the full HDR range into [0, 1).
 * Never clips, but can look washed out without exposure adjustment.
 */
export function reinhard(v: number): number {
  if (v < 0) return 0;
  return v / (1 + v);
}

/**
 * ACES filmic tone mapping (simplified fit by Krzysztof Narkowicz).
 * Attempt at a cinematic look with good contrast and saturation.
 *
 * f(x) = (x(ax + b)) / (x(cx + d) + e)
 * where a=2.51, b=0.03, c=2.43, d=0.59, e=0.14
 */
export function aces(v: number): number {
  if (v < 0) return 0;
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  const mapped = (v * (a * v + b)) / (v * (c * v + d) + e);
  return mapped < 0 ? 0 : mapped > 1 ? 1 : mapped;
}

/** Built-in algorithm registry. */
export const TONE_MAP_ALGORITHMS = {
  clamp,
  reinhard,
  aces,
} as const;

export type ToneMapAlgorithm = keyof typeof TONE_MAP_ALGORITHMS;

// ─── Options ─────────────────────────────────────────────────────────

export type OutputDepth = 8 | 16;

export interface ToneMapOptions {
  /** Tone mapping algorithm name or custom function. */
  algorithm: ToneMapAlgorithm | ToneMapFn;

  /**
   * Exposure adjustment in stops. RGB values are multiplied by 2^exposure
   * before tone mapping. Default: 0 (no adjustment).
   */
  exposure?: number;

  /**
   * Gamma correction value. Applied after tone mapping as v^(1/gamma).
   * Default: 2.2 (standard sRGB).
   */
  gamma?: number;

  /**
   * Output bit depth. 8 → Uint8Array [0,255], 16 → Uint16Array [0,65535].
   * Default: 8.
   */
  outputDepth?: OutputDepth;
}

// ─── ToneMapper class ────────────────────────────────────────────────

export class ToneMapper {
  private readonly mapFn: ToneMapFn;
  private readonly exposureMultiplier: number;
  private readonly invGamma: number;
  private readonly outputDepth: OutputDepth;
  private readonly maxVal: number;

  constructor(options: ToneMapOptions) {
    // Resolve algorithm
    if (typeof options.algorithm === 'function') {
      this.mapFn = options.algorithm;
    } else {
      const fn = TONE_MAP_ALGORITHMS[options.algorithm];
      if (!fn) {
        throw new Error(
          `Unknown tone map algorithm: "${options.algorithm}". ` +
          `Available: ${Object.keys(TONE_MAP_ALGORITHMS).join(', ')}`
        );
      }
      this.mapFn = fn;
    }

    const exposure = options.exposure ?? 0;
    this.exposureMultiplier = Math.pow(2, exposure);

    const gamma = options.gamma ?? 2.2;
    if (gamma <= 0) {
      throw new Error(`Gamma must be positive, got: ${gamma}`);
    }
    this.invGamma = 1 / gamma;

    this.outputDepth = options.outputDepth ?? 8;
    if (this.outputDepth !== 8 && this.outputDepth !== 16) {
      throw new Error(`Output depth must be 8 or 16, got: ${this.outputDepth}`);
    }
    this.maxVal = this.outputDepth === 16 ? 65535 : 255;
  }

  /**
   * Map a single HDR channel value through the full pipeline.
   * Useful for testing. Does NOT apply to alpha.
   */
  mapValue(v: number): number {
    // 1. Exposure
    const exposed = v * this.exposureMultiplier;
    // 2. Tone map
    const mapped = this.mapFn(exposed);
    // 3. Gamma
    return Math.pow(mapped, this.invGamma);
  }

  /**
   * Quantize a [0,1] float to the output integer range.
   */
  quantize(v: number): number {
    const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
    return Math.round(clamped * this.maxVal);
  }

  /**
   * Process an entire ColorBuffer → quantized RGBA output.
   *
   * Returns Uint8Array (outputDepth=8) or Uint16Array (outputDepth=16).
   * Output has the same pixel layout: 4 values per pixel [R, G, B, A].
   */
  map(input: IColorBuffer): Uint8Array | Uint16Array {
    const pixelCount = input.width * input.height;
    const totalValues = pixelCount * 4;
    const src = input.data;

    const dst: Uint8Array | Uint16Array =
      this.outputDepth === 16
        ? new Uint16Array(totalValues)
        : new Uint8Array(totalValues);

    const exposureMul = this.exposureMultiplier;
    const mapFn = this.mapFn;
    const invGamma = this.invGamma;
    const maxVal = this.maxVal;

    // Build a LUT for gamma correction when outputting 8-bit.
    // Maps integer [0..LUT_SIZE] → gamma-corrected [0..maxVal].
    // This replaces per-pixel Math.pow with a table lookup.
    const useGammaLut = this.outputDepth === 8;
    const LUT_SIZE = 4096;
    let gammaLut: Uint8Array | null = null;

    if (useGammaLut) {
      gammaLut = new Uint8Array(LUT_SIZE + 1);
      for (let i = 0; i <= LUT_SIZE; i++) {
        const v = i / LUT_SIZE;
        gammaLut[i] = Math.round(Math.pow(v, invGamma) * maxVal);
      }
    }

    // Hot loop — fully unrolled RGB channels, no inner loop.
    // Non-null assertions are safe: loop bounds are derived from array length.
    if (gammaLut) {
      // Fast path: 8-bit output with LUT gamma
      for (let i = 0; i < totalValues; i += 4) {
        // R
        let mapped = mapFn(src[i]! * exposureMul);
        mapped = mapped < 0 ? 0 : mapped > 1 ? 1 : mapped;
        dst[i] = gammaLut[(mapped * LUT_SIZE + 0.5) | 0]!;

        // G
        mapped = mapFn(src[i + 1]! * exposureMul);
        mapped = mapped < 0 ? 0 : mapped > 1 ? 1 : mapped;
        dst[i + 1] = gammaLut[(mapped * LUT_SIZE + 0.5) | 0]!;

        // B
        mapped = mapFn(src[i + 2]! * exposureMul);
        mapped = mapped < 0 ? 0 : mapped > 1 ? 1 : mapped;
        dst[i + 2] = gammaLut[(mapped * LUT_SIZE + 0.5) | 0]!;

        // Alpha: clamp and quantize directly
        const a = src[i + 3]!;
        dst[i + 3] = Math.round((a < 0 ? 0 : a > 1 ? 1 : a) * maxVal);
      }
    } else {
      // 16-bit path: use Math.pow (LUT would be too large)
      for (let i = 0; i < totalValues; i += 4) {
        for (let c = 0; c < 3; c++) {
          const exposed = src[i + c]! * exposureMul;
          const mapped = mapFn(exposed);
          const gammaed = Math.pow(mapped, invGamma);
          const clamped = gammaed < 0 ? 0 : gammaed > 1 ? 1 : gammaed;
          dst[i + c] = Math.round(clamped * maxVal);
        }

        const a = src[i + 3]!;
        const aClamped = a < 0 ? 0 : a > 1 ? 1 : a;
        dst[i + 3] = Math.round(aClamped * maxVal);
      }
    }

    return dst;
  }
}
