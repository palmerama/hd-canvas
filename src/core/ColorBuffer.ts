/**
 * ColorBuffer — Float32/Float64 RGBA pixel buffer
 *
 * The foundation of the HD Canvas framework. Stores pixel data as
 * unbounded floats (0.0–1.0 is "standard" range, >1.0 is HDR).
 * Row-major layout, 4 floats per pixel (R, G, B, A).
 */

export type ColorDepth = 32 | 64;
export type BlendMode = 'normal' | 'add' | 'multiply';
export type RGBA = [r: number, g: number, b: number, a: number];

/** Minimal interface for reading pixel data — used by the export pipeline. */
export interface IColorBuffer {
  readonly width: number;
  readonly height: number;
  readonly depth: ColorDepth;
  readonly data: Float32Array | Float64Array;
}

export class ColorBuffer implements IColorBuffer {
  readonly width: number;
  readonly height: number;
  readonly depth: ColorDepth;
  readonly data: Float32Array | Float64Array;

  constructor(width: number, height: number, depth: ColorDepth = 32) {
    if (!Number.isInteger(width) || width <= 0) {
      throw new RangeError(`width must be a positive integer, got ${width}`);
    }
    if (!Number.isInteger(height) || height <= 0) {
      throw new RangeError(`height must be a positive integer, got ${height}`);
    }

    this.width = width;
    this.height = height;
    this.depth = depth;

    const length = width * height * 4;
    this.data = depth === 64 ? new Float64Array(length) : new Float32Array(length);
  }

  /** Byte size of the underlying typed array */
  get byteLength(): number {
    return this.data.byteLength;
  }

  private offset(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new RangeError(
        `Pixel (${x}, ${y}) out of bounds for ${this.width}×${this.height} buffer`
      );
    }
    return (y * this.width + x) * 4;
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a: number = 1.0): void {
    const i = this.offset(x, y);
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }

  getPixel(x: number, y: number): RGBA {
    const i = this.offset(x, y);
    return [
      this.data[i]!,
      this.data[i + 1]!,
      this.data[i + 2]!,
      this.data[i + 3]!,
    ];
  }

  /**
   * Blend a color onto the existing pixel using the specified blend mode.
   * All modes use standard alpha compositing for the alpha channel.
   */
  blendPixel(
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
    mode: BlendMode = 'normal'
  ): void {
    const i = this.offset(x, y);
    const dstR = this.data[i]!;
    const dstG = this.data[i + 1]!;
    const dstB = this.data[i + 2]!;
    const dstA = this.data[i + 3]!;

    let blendedR: number;
    let blendedG: number;
    let blendedB: number;

    switch (mode) {
      case 'normal':
        blendedR = r;
        blendedG = g;
        blendedB = b;
        break;
      case 'add':
        blendedR = dstR + r;
        blendedG = dstG + g;
        blendedB = dstB + b;
        break;
      case 'multiply':
        blendedR = dstR * r;
        blendedG = dstG * g;
        blendedB = dstB * b;
        break;
      default: {
        const _exhaustive: never = mode;
        throw new Error(`Unknown blend mode: ${_exhaustive}`);
      }
    }

    // Alpha compositing: src over dst
    const outA = a + dstA * (1 - a);
    if (outA === 0) {
      this.data[i] = 0;
      this.data[i + 1] = 0;
      this.data[i + 2] = 0;
      this.data[i + 3] = 0;
    } else {
      this.data[i] = (blendedR * a + dstR * dstA * (1 - a)) / outA;
      this.data[i + 1] = (blendedG * a + dstG * dstA * (1 - a)) / outA;
      this.data[i + 2] = (blendedB * a + dstB * dstA * (1 - a)) / outA;
      this.data[i + 3] = outA;
    }
  }

  /** Fill the entire buffer with a single color (default: transparent black) */
  clear(r: number = 0, g: number = 0, b: number = 0, a: number = 0): void {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = a;
    }
  }

  /** Extract a rectangular region as a new ColorBuffer */
  getRegion(x: number, y: number, w: number, h: number): ColorBuffer {
    if (x < 0 || y < 0 || x + w > this.width || y + h > this.height) {
      throw new RangeError(
        `Region (${x},${y} ${w}×${h}) exceeds buffer bounds ${this.width}×${this.height}`
      );
    }
    if (w <= 0 || h <= 0) {
      throw new RangeError(`Region dimensions must be positive, got ${w}×${h}`);
    }

    const region = new ColorBuffer(w, h, this.depth);
    for (let row = 0; row < h; row++) {
      const srcStart = ((y + row) * this.width + x) * 4;
      const dstStart = row * w * 4;
      region.data.set(this.data.subarray(srcStart, srcStart + w * 4), dstStart);
    }
    return region;
  }

  /** Write a ColorBuffer region into this buffer at the given position */
  putRegion(x: number, y: number, region: ColorBuffer): void {
    if (x < 0 || y < 0 || x + region.width > this.width || y + region.height > this.height) {
      throw new RangeError(
        `Region (${x},${y} ${region.width}×${region.height}) exceeds buffer bounds ${this.width}×${this.height}`
      );
    }

    for (let row = 0; row < region.height; row++) {
      const srcStart = row * region.width * 4;
      const dstStart = ((y + row) * this.width + x) * 4;
      this.data.set(region.data.subarray(srcStart, srcStart + region.width * 4), dstStart);
    }
  }
}
