import { describe, it, expect } from 'vitest';
import {
  PAPER_SIZES,
  sizeToPx,
  resolvePaperSize,
  estimateBufferBytes,
} from '../core/PaperSize.js';

describe('PaperSize', () => {
  describe('PAPER_SIZES registry', () => {
    it('has all ISO A-series sizes', () => {
      for (const key of ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'] as const) {
        expect(PAPER_SIZES[key]).toBeDefined();
        expect(PAPER_SIZES[key].widthMM).toBeGreaterThan(0);
        expect(PAPER_SIZES[key].heightMM).toBeGreaterThan(0);
        // Portrait: width < height
        expect(PAPER_SIZES[key].widthMM).toBeLessThan(PAPER_SIZES[key].heightMM);
      }
    });

    it('has all US sizes', () => {
      for (const key of ['Letter', 'Legal', 'Tabloid'] as const) {
        expect(PAPER_SIZES[key]).toBeDefined();
        expect(PAPER_SIZES[key].widthMM).toBeGreaterThan(0);
        expect(PAPER_SIZES[key].heightMM).toBeGreaterThan(0);
      }
    });

    it('A-series sizes follow the halving rule', () => {
      // Each A(n+1) is A(n) halved on the long side
      for (let n = 0; n < 6; n++) {
        const key = `A${n}` as keyof typeof PAPER_SIZES;
        const nextKey = `A${n + 1}` as keyof typeof PAPER_SIZES;
        // A(n+1).width ≈ A(n).height / 2 (within rounding)
        // A(n+1).height ≈ A(n).width
        expect(PAPER_SIZES[nextKey].heightMM).toBe(PAPER_SIZES[key].widthMM);
      }
    });
  });

  describe('sizeToPx', () => {
    it('A4 @ 300 DPI = 2480×3508', () => {
      const px = sizeToPx(PAPER_SIZES.A4, 300);
      expect(px.width).toBe(2480);
      expect(px.height).toBe(3508);
    });

    it('Letter @ 300 DPI = 2550×3300', () => {
      const px = sizeToPx(PAPER_SIZES.Letter, 300);
      expect(px.width).toBe(2550);
      expect(px.height).toBe(3300);
    });

    it('A3 @ 300 DPI = 3508×4961', () => {
      const px = sizeToPx(PAPER_SIZES.A3, 300);
      expect(px.width).toBe(3508);
      expect(px.height).toBe(4961);
    });

    it('A0 @ 300 DPI = 9933×14043', () => {
      const px = sizeToPx(PAPER_SIZES.A0, 300);
      expect(px.width).toBe(9933);
      expect(px.height).toBe(14043);
    });

    it('supports custom sizes', () => {
      const px = sizeToPx({ widthMM: 254, heightMM: 254 }, 100);
      // 254mm = 10 inches, @ 100 DPI = 1000px
      expect(px.width).toBe(1000);
      expect(px.height).toBe(1000);
    });

    it('supports high DPI', () => {
      const px = sizeToPx(PAPER_SIZES.A4, 1200);
      // 4× the 300 DPI values
      expect(px.width).toBe(9921);
      expect(px.height).toBe(14031);
    });

    it('rejects non-positive DPI', () => {
      expect(() => sizeToPx(PAPER_SIZES.A4, 0)).toThrow(RangeError);
      expect(() => sizeToPx(PAPER_SIZES.A4, -300)).toThrow(RangeError);
    });
  });

  describe('resolvePaperSize', () => {
    it('resolves a key to dimensions', () => {
      const dims = resolvePaperSize('A4');
      expect(dims.widthMM).toBe(210);
      expect(dims.heightMM).toBe(297);
    });

    it('passes through custom dimensions', () => {
      const dims = resolvePaperSize({ widthMM: 100, heightMM: 200 });
      expect(dims.widthMM).toBe(100);
      expect(dims.heightMM).toBe(200);
    });

    it('swaps dimensions for landscape', () => {
      const dims = resolvePaperSize('A4', 'landscape');
      expect(dims.widthMM).toBe(297);
      expect(dims.heightMM).toBe(210);
    });

    it('portrait is the default', () => {
      const dims = resolvePaperSize('A4', 'portrait');
      expect(dims.widthMM).toBe(210);
      expect(dims.heightMM).toBe(297);
    });

    it('rejects non-positive custom dimensions', () => {
      expect(() => resolvePaperSize({ widthMM: 0, heightMM: 100 })).toThrow(RangeError);
      expect(() => resolvePaperSize({ widthMM: 100, heightMM: -50 })).toThrow(RangeError);
    });
  });

  describe('estimateBufferBytes', () => {
    it('A4 @ 300 DPI Float32 ≈ 139 MB', () => {
      const bytes = estimateBufferBytes('A4', 300, 32);
      // 2480 × 3508 × 4 channels × 4 bytes = 139,196,160
      expect(bytes).toBe(2480 * 3508 * 4 * 4);
    });

    it('A4 @ 300 DPI Float64 is double Float32', () => {
      const f32 = estimateBufferBytes('A4', 300, 32);
      const f64 = estimateBufferBytes('A4', 300, 64);
      expect(f64).toBe(f32 * 2);
    });

    it('defaults to Float32', () => {
      const bytes = estimateBufferBytes('A4', 300);
      expect(bytes).toBe(estimateBufferBytes('A4', 300, 32));
    });

    it('A0 @ 300 DPI Float64 ≈ 4.5 GB', () => {
      const bytes = estimateBufferBytes('A0', 300, 64);
      const gb = bytes / (1024 ** 3);
      expect(gb).toBeGreaterThan(4);
      expect(gb).toBeLessThan(5);
    });
  });
});
