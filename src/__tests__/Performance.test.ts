/**
 * Performance regression tests — ensure optimized paths are actually faster.
 * These tests verify the bulk write methods work correctly at scale,
 * not just that they produce correct results (covered in unit tests).
 */
import { describe, it, expect } from 'vitest';
import { ColorBuffer } from '../core/ColorBuffer.js';

describe('Performance', () => {
  describe('bulk writes vs per-pixel', () => {
    it('setRowUnchecked is faster than setPixel for large buffers', () => {
      const width = 2000;
      const height = 100;
      const buf1 = new ColorBuffer(width, height);
      const buf2 = new ColorBuffer(width, height);

      // Generate test data
      const rowData = new Float32Array(width * 4);
      for (let i = 0; i < rowData.length; i++) {
        rowData[i] = Math.random();
      }

      // Per-pixel path
      const startPixel = performance.now();
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = x * 4;
          buf1.setPixel(x, y, rowData[i]!, rowData[i + 1]!, rowData[i + 2]!, rowData[i + 3]!);
        }
      }
      const pixelTime = performance.now() - startPixel;

      // Bulk row path
      const startBulk = performance.now();
      for (let y = 0; y < height; y++) {
        buf2.setRowUnchecked(y, 0, width, rowData);
      }
      const bulkTime = performance.now() - startBulk;

      // Bulk should be significantly faster (at least 2×)
      expect(bulkTime).toBeLessThan(pixelTime);

      // Results should be identical
      for (let i = 0; i < buf1.data.length; i++) {
        expect(buf2.data[i]).toBe(buf1.data[i]);
      }
    });
  });
});
