import { describe, it, expect } from 'vitest';
import { ColorBuffer, type BlendMode } from '../core/ColorBuffer.js';

describe('ColorBuffer', () => {
  describe('construction', () => {
    it('creates a Float32 buffer by default', () => {
      const buf = new ColorBuffer(10, 20);
      expect(buf.width).toBe(10);
      expect(buf.height).toBe(20);
      expect(buf.depth).toBe(32);
      expect(buf.data).toBeInstanceOf(Float32Array);
      expect(buf.data.length).toBe(10 * 20 * 4);
    });

    it('creates a Float64 buffer when depth=64', () => {
      const buf = new ColorBuffer(5, 5, 64);
      expect(buf.depth).toBe(64);
      expect(buf.data).toBeInstanceOf(Float64Array);
      expect(buf.data.length).toBe(5 * 5 * 4);
    });

    it('reports correct byteLength', () => {
      const f32 = new ColorBuffer(10, 10, 32);
      expect(f32.byteLength).toBe(10 * 10 * 4 * 4); // 4 channels × 4 bytes

      const f64 = new ColorBuffer(10, 10, 64);
      expect(f64.byteLength).toBe(10 * 10 * 4 * 8); // 4 channels × 8 bytes
    });

    it('initializes all values to zero', () => {
      const buf = new ColorBuffer(3, 3);
      for (let i = 0; i < buf.data.length; i++) {
        expect(buf.data[i]).toBe(0);
      }
    });

    it('rejects invalid dimensions', () => {
      expect(() => new ColorBuffer(0, 10)).toThrow(RangeError);
      expect(() => new ColorBuffer(10, -1)).toThrow(RangeError);
      expect(() => new ColorBuffer(1.5, 10)).toThrow(RangeError);
    });
  });

  describe('setPixel / getPixel', () => {
    it('round-trips pixel values', () => {
      const buf = new ColorBuffer(10, 10);
      buf.setPixel(5, 7, 0.2, 0.4, 0.6, 0.8);
      const [r, g, b, a] = buf.getPixel(5, 7);
      expect(r).toBeCloseTo(0.2);
      expect(g).toBeCloseTo(0.4);
      expect(b).toBeCloseTo(0.6);
      expect(a).toBeCloseTo(0.8);
    });

    it('defaults alpha to 1.0', () => {
      const buf = new ColorBuffer(5, 5);
      buf.setPixel(0, 0, 1, 0, 0);
      expect(buf.getPixel(0, 0)[3]).toBe(1.0);
    });

    it('supports HDR values > 1.0', () => {
      const buf = new ColorBuffer(5, 5);
      buf.setPixel(0, 0, 2.5, 10.0, 0.001, 1.0);
      const [r, g, b] = buf.getPixel(0, 0);
      expect(r).toBeCloseTo(2.5);
      expect(g).toBeCloseTo(10.0);
      expect(b).toBeCloseTo(0.001);
    });

    it('supports negative values (useful for signed operations)', () => {
      const buf = new ColorBuffer(5, 5);
      buf.setPixel(0, 0, -0.5, -1.0, 0, 1);
      const [r, g] = buf.getPixel(0, 0);
      expect(r).toBeCloseTo(-0.5);
      expect(g).toBeCloseTo(-1.0);
    });

    it('throws on out-of-bounds access', () => {
      const buf = new ColorBuffer(10, 10);
      expect(() => buf.getPixel(-1, 0)).toThrow(RangeError);
      expect(() => buf.getPixel(10, 0)).toThrow(RangeError);
      expect(() => buf.getPixel(0, 10)).toThrow(RangeError);
      expect(() => buf.setPixel(10, 10, 0, 0, 0)).toThrow(RangeError);
    });

    it('works with Float64 depth', () => {
      const buf = new ColorBuffer(5, 5, 64);
      buf.setPixel(2, 3, 0.123456789012345, 0, 0, 1);
      const [r] = buf.getPixel(2, 3);
      // Float64 should preserve more precision than Float32
      expect(r).toBeCloseTo(0.123456789012345, 12);
    });
  });

  describe('blendPixel', () => {
    it('normal blend: fully opaque src replaces dst', () => {
      const buf = new ColorBuffer(5, 5);
      buf.setPixel(0, 0, 1, 0, 0, 1); // red
      buf.blendPixel(0, 0, 0, 1, 0, 1, 'normal'); // green, fully opaque
      const [r, g, b, a] = buf.getPixel(0, 0);
      expect(r).toBeCloseTo(0);
      expect(g).toBeCloseTo(1);
      expect(b).toBeCloseTo(0);
      expect(a).toBeCloseTo(1);
    });

    it('normal blend: 50% alpha blends colors', () => {
      const buf = new ColorBuffer(5, 5);
      buf.setPixel(0, 0, 1, 0, 0, 1); // red, fully opaque
      buf.blendPixel(0, 0, 0, 1, 0, 0.5, 'normal'); // green, 50%
      const [r, g, , a] = buf.getPixel(0, 0);
      expect(a).toBeCloseTo(1.0);
      expect(r).toBeCloseTo(0.5);
      expect(g).toBeCloseTo(0.5);
    });

    it('normal blend: zero alpha is a no-op', () => {
      const buf = new ColorBuffer(5, 5);
      buf.setPixel(0, 0, 1, 0, 0, 1);
      buf.blendPixel(0, 0, 0, 1, 0, 0, 'normal');
      const [r, g] = buf.getPixel(0, 0);
      expect(r).toBeCloseTo(1);
      expect(g).toBeCloseTo(0);
    });

    it('add blend: adds color values', () => {
      const buf = new ColorBuffer(5, 5);
      buf.setPixel(0, 0, 0.5, 0.3, 0.1, 1);
      buf.blendPixel(0, 0, 0.2, 0.4, 0.6, 1, 'add');
      const [r, g, b] = buf.getPixel(0, 0);
      expect(r).toBeCloseTo(0.7);
      expect(g).toBeCloseTo(0.7);
      expect(b).toBeCloseTo(0.7);
    });

    it('multiply blend: multiplies color values', () => {
      const buf = new ColorBuffer(5, 5);
      buf.setPixel(0, 0, 0.5, 0.8, 1.0, 1);
      buf.blendPixel(0, 0, 0.5, 0.5, 0.5, 1, 'multiply');
      const [r, g, b] = buf.getPixel(0, 0);
      expect(r).toBeCloseTo(0.25);
      expect(g).toBeCloseTo(0.4);
      expect(b).toBeCloseTo(0.5);
    });

    it('defaults to normal blend mode', () => {
      const buf = new ColorBuffer(5, 5);
      buf.setPixel(0, 0, 1, 0, 0, 1);
      buf.blendPixel(0, 0, 0, 0, 1, 1);
      const [r, , b] = buf.getPixel(0, 0);
      expect(r).toBeCloseTo(0);
      expect(b).toBeCloseTo(1);
    });
  });

  describe('clear', () => {
    it('clears to transparent black by default', () => {
      const buf = new ColorBuffer(3, 3);
      buf.setPixel(1, 1, 1, 1, 1, 1);
      buf.clear();
      const [r, g, b, a] = buf.getPixel(1, 1);
      expect(r).toBe(0);
      expect(g).toBe(0);
      expect(b).toBe(0);
      expect(a).toBe(0);
    });

    it('clears to a specified color', () => {
      const buf = new ColorBuffer(3, 3);
      buf.clear(0.1, 0.2, 0.3, 1.0);
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          const [r, g, b, a] = buf.getPixel(x, y);
          expect(r).toBeCloseTo(0.1);
          expect(g).toBeCloseTo(0.2);
          expect(b).toBeCloseTo(0.3);
          expect(a).toBeCloseTo(1.0);
        }
      }
    });
  });

  describe('getRegion / putRegion', () => {
    it('extracts a region as a new buffer', () => {
      const buf = new ColorBuffer(10, 10);
      buf.setPixel(3, 4, 1, 0, 0, 1);
      buf.setPixel(4, 5, 0, 1, 0, 1);

      const region = buf.getRegion(3, 4, 2, 2);
      expect(region.width).toBe(2);
      expect(region.height).toBe(2);
      expect(region.getPixel(0, 0)).toEqual([1, 0, 0, 1]); // was (3,4)
      expect(region.getPixel(1, 1)).toEqual([0, 1, 0, 1]); // was (4,5)
    });

    it('putRegion writes a buffer into this buffer', () => {
      const buf = new ColorBuffer(10, 10);
      const patch = new ColorBuffer(2, 2);
      patch.setPixel(0, 0, 1, 0, 0, 1);
      patch.setPixel(1, 1, 0, 0, 1, 1);

      buf.putRegion(5, 5, patch);
      expect(buf.getPixel(5, 5)).toEqual([1, 0, 0, 1]);
      expect(buf.getPixel(6, 6)).toEqual([0, 0, 1, 1]);
      // Untouched pixels remain zero
      expect(buf.getPixel(0, 0)).toEqual([0, 0, 0, 0]);
    });

    it('round-trips through getRegion/putRegion', () => {
      const buf = new ColorBuffer(10, 10);
      buf.clear(0.5, 0.5, 0.5, 1);
      const region = buf.getRegion(2, 2, 4, 4);

      const buf2 = new ColorBuffer(10, 10);
      buf2.putRegion(2, 2, region);

      for (let y = 2; y < 6; y++) {
        for (let x = 2; x < 6; x++) {
          const [r, g, b, a] = buf2.getPixel(x, y);
          expect(r).toBeCloseTo(0.5);
          expect(g).toBeCloseTo(0.5);
          expect(b).toBeCloseTo(0.5);
          expect(a).toBeCloseTo(1);
        }
      }
    });

    it('rejects out-of-bounds regions', () => {
      const buf = new ColorBuffer(10, 10);
      expect(() => buf.getRegion(8, 8, 5, 5)).toThrow(RangeError);
      expect(() => buf.getRegion(-1, 0, 2, 2)).toThrow(RangeError);

      const patch = new ColorBuffer(5, 5);
      expect(() => buf.putRegion(8, 8, patch)).toThrow(RangeError);
    });

    it('rejects zero/negative region dimensions', () => {
      const buf = new ColorBuffer(10, 10);
      expect(() => buf.getRegion(0, 0, 0, 5)).toThrow(RangeError);
      expect(() => buf.getRegion(0, 0, 5, -1)).toThrow(RangeError);
    });

    it('preserves depth in extracted regions', () => {
      const buf = new ColorBuffer(10, 10, 64);
      const region = buf.getRegion(0, 0, 5, 5);
      expect(region.depth).toBe(64);
      expect(region.data).toBeInstanceOf(Float64Array);
    });
  });

  describe('setPixelUnchecked', () => {
    it('writes pixel data without bounds checking', () => {
      const buf = new ColorBuffer(10, 10);
      buf.setPixelUnchecked(5, 7, 0.2, 0.4, 0.6, 0.8);
      const [r, g, b, a] = buf.getPixel(5, 7);
      expect(r).toBeCloseTo(0.2);
      expect(g).toBeCloseTo(0.4);
      expect(b).toBeCloseTo(0.6);
      expect(a).toBeCloseTo(0.8);
    });

    it('defaults alpha to 1.0', () => {
      const buf = new ColorBuffer(5, 5);
      buf.setPixelUnchecked(0, 0, 1, 0, 0);
      expect(buf.getPixel(0, 0)[3]).toBe(1.0);
    });

    it('produces identical results to setPixel', () => {
      const buf1 = new ColorBuffer(10, 10);
      const buf2 = new ColorBuffer(10, 10);
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          const r = Math.random(), g = Math.random(), b = Math.random(), a = Math.random();
          buf1.setPixel(x, y, r, g, b, a);
          buf2.setPixelUnchecked(x, y, r, g, b, a);
        }
      }
      for (let i = 0; i < buf1.data.length; i++) {
        expect(buf2.data[i]).toBe(buf1.data[i]);
      }
    });
  });

  describe('blendPixelUnchecked', () => {
    it('normal blend matches blendPixel', () => {
      const buf1 = new ColorBuffer(5, 5);
      const buf2 = new ColorBuffer(5, 5);
      buf1.setPixel(0, 0, 1, 0, 0, 1);
      buf2.setPixel(0, 0, 1, 0, 0, 1);
      buf1.blendPixel(0, 0, 0, 1, 0, 0.5, 'normal');
      buf2.blendPixelUnchecked(0, 0, 0, 1, 0, 0.5, 'normal');
      for (let i = 0; i < 4; i++) {
        expect(buf2.data[i]).toBeCloseTo(buf1.data[i]!, 10);
      }
    });

    it('add blend matches blendPixel', () => {
      const buf1 = new ColorBuffer(5, 5);
      const buf2 = new ColorBuffer(5, 5);
      buf1.setPixel(0, 0, 0.5, 0.3, 0.1, 1);
      buf2.setPixel(0, 0, 0.5, 0.3, 0.1, 1);
      buf1.blendPixel(0, 0, 0.2, 0.4, 0.6, 1, 'add');
      buf2.blendPixelUnchecked(0, 0, 0.2, 0.4, 0.6, 1, 'add');
      for (let i = 0; i < 4; i++) {
        expect(buf2.data[i]).toBeCloseTo(buf1.data[i]!, 10);
      }
    });

    it('multiply blend matches blendPixel', () => {
      const buf1 = new ColorBuffer(5, 5);
      const buf2 = new ColorBuffer(5, 5);
      buf1.setPixel(0, 0, 0.5, 0.8, 1.0, 1);
      buf2.setPixel(0, 0, 0.5, 0.8, 1.0, 1);
      buf1.blendPixel(0, 0, 0.5, 0.5, 0.5, 1, 'multiply');
      buf2.blendPixelUnchecked(0, 0, 0.5, 0.5, 0.5, 1, 'multiply');
      for (let i = 0; i < 4; i++) {
        expect(buf2.data[i]).toBeCloseTo(buf1.data[i]!, 10);
      }
    });
  });

  describe('setRowUnchecked', () => {
    it('writes a full row of float data', () => {
      const buf = new ColorBuffer(4, 4);
      const row = new Float32Array([
        1, 0, 0, 1,  // red
        0, 1, 0, 1,  // green
        0, 0, 1, 1,  // blue
        1, 1, 0, 1,  // yellow
      ]);
      buf.setRowUnchecked(2, 0, 4, row);

      expect(buf.getPixel(0, 2)).toEqual([1, 0, 0, 1]);
      expect(buf.getPixel(1, 2)).toEqual([0, 1, 0, 1]);
      expect(buf.getPixel(2, 2)).toEqual([0, 0, 1, 1]);
      expect(buf.getPixel(3, 2)).toEqual([1, 1, 0, 1]);
    });

    it('writes a partial row starting at an offset', () => {
      const buf = new ColorBuffer(10, 10);
      buf.clear(0.5, 0.5, 0.5, 1);
      const row = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]); // 2 pixels
      buf.setRowUnchecked(5, 3, 2, row);

      expect(buf.getPixel(3, 5)).toEqual([1, 0, 0, 1]);
      expect(buf.getPixel(4, 5)).toEqual([0, 1, 0, 1]);
      // Adjacent pixels untouched
      const [r] = buf.getPixel(2, 5);
      expect(r).toBeCloseTo(0.5);
    });

    it('works with Float64 buffers', () => {
      const buf = new ColorBuffer(4, 4, 64);
      const row = new Float64Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
      buf.setRowUnchecked(0, 0, 2, row);

      const [r, g, b, a] = buf.getPixel(0, 0);
      expect(r).toBeCloseTo(0.1);
      expect(g).toBeCloseTo(0.2);
      expect(b).toBeCloseTo(0.3);
      expect(a).toBeCloseTo(0.4);
    });

    it('produces identical results to setPixel', () => {
      const buf1 = new ColorBuffer(100, 1);
      const buf2 = new ColorBuffer(100, 1);
      const row = new Float32Array(100 * 4);
      for (let i = 0; i < 100; i++) {
        const r = Math.random();
        const g = Math.random();
        const b = Math.random();
        const a = Math.random();
        row[i * 4] = r;
        row[i * 4 + 1] = g;
        row[i * 4 + 2] = b;
        row[i * 4 + 3] = a;
        buf1.setPixel(i, 0, r, g, b, a);
      }
      buf2.setRowUnchecked(0, 0, 100, row);

      for (let i = 0; i < buf1.data.length; i++) {
        expect(buf2.data[i]).toBe(buf1.data[i]);
      }
    });
  });

  describe('blendRowUnchecked', () => {
    it('blends a row with normal mode', () => {
      const buf = new ColorBuffer(3, 1);
      buf.clear(1, 0, 0, 1); // red background
      const row = new Float32Array([
        0, 1, 0, 1,    // green, fully opaque → replaces
        0, 0, 1, 0.5,  // blue, 50% → blends
        0, 0, 0, 0,    // transparent → skipped
      ]);
      buf.blendRowUnchecked(0, 0, 3, row, 'normal');

      // Fully opaque green replaces red
      const [r0, g0] = buf.getPixel(0, 0);
      expect(r0).toBeCloseTo(0);
      expect(g0).toBeCloseTo(1);

      // 50% blue blended over red
      const [r1, , b1, a1] = buf.getPixel(1, 0);
      expect(a1).toBeCloseTo(1);
      expect(r1).toBeGreaterThan(0.1);
      expect(b1).toBeGreaterThan(0.1);

      // Transparent pixel → original red preserved
      const [r2, g2] = buf.getPixel(2, 0);
      expect(r2).toBeCloseTo(1);
      expect(g2).toBeCloseTo(0);
    });

    it('blends with add mode', () => {
      const buf = new ColorBuffer(2, 1);
      buf.setPixel(0, 0, 0.3, 0.3, 0.3, 1);
      buf.setPixel(1, 0, 0.5, 0.5, 0.5, 1);
      const row = new Float32Array([
        0.2, 0.2, 0.2, 1,
        0.3, 0.3, 0.3, 1,
      ]);
      buf.blendRowUnchecked(0, 0, 2, row, 'add');

      const [r0] = buf.getPixel(0, 0);
      expect(r0).toBeCloseTo(0.5);
      const [r1] = buf.getPixel(1, 0);
      expect(r1).toBeCloseTo(0.8);
    });

    it('produces identical results to per-pixel blendPixel', () => {
      const buf1 = new ColorBuffer(50, 1);
      const buf2 = new ColorBuffer(50, 1);
      // Same background
      buf1.clear(0.5, 0.3, 0.7, 1);
      buf2.clear(0.5, 0.3, 0.7, 1);

      const row = new Float32Array(50 * 4);
      for (let i = 0; i < 50; i++) {
        const r = Math.random();
        const g = Math.random();
        const b = Math.random();
        const a = Math.random();
        row[i * 4] = r;
        row[i * 4 + 1] = g;
        row[i * 4 + 2] = b;
        row[i * 4 + 3] = a;
        buf1.blendPixel(i, 0, r, g, b, a, 'normal');
      }
      buf2.blendRowUnchecked(0, 0, 50, row, 'normal');

      for (let i = 0; i < buf1.data.length; i++) {
        expect(buf2.data[i]).toBeCloseTo(buf1.data[i]!, 5);
      }
    });
  });
});
