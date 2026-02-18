import { describe, it, expect } from 'vitest';
import { calculateFit } from '../preview/FitStrategy.js';

describe('FitStrategy', () => {
  describe('contain mode', () => {
    it('fits a tall source into a wide container (letterbox sides)', () => {
      // A4 aspect (2480×3508) into 800×600 container
      const fit = calculateFit(2480, 3508, 800, 600, 'contain');
      // Height-limited: scale = 600/3508 ≈ 0.171
      expect(fit.displayHeight).toBe(600);
      expect(fit.displayWidth).toBeLessThan(800);
      expect(fit.offsetX).toBeGreaterThan(0); // centered horizontally
      expect(fit.offsetY).toBe(0);
      expect(fit.scale).toBeCloseTo(600 / 3508, 3);
    });

    it('fits a wide source into a tall container (letterbox top/bottom)', () => {
      // Landscape A4 into 600×800 container
      const fit = calculateFit(3508, 2480, 600, 800, 'contain');
      expect(fit.displayWidth).toBe(600);
      expect(fit.displayHeight).toBeLessThan(800);
      expect(fit.offsetX).toBe(0);
      expect(fit.offsetY).toBeGreaterThan(0);
    });

    it('exact fit produces no offset', () => {
      const fit = calculateFit(100, 100, 200, 200, 'contain');
      expect(fit.displayWidth).toBe(200);
      expect(fit.displayHeight).toBe(200);
      expect(fit.offsetX).toBe(0);
      expect(fit.offsetY).toBe(0);
      expect(fit.scale).toBe(2);
    });

    it('same aspect ratio fills container exactly', () => {
      const fit = calculateFit(1000, 500, 400, 200, 'contain');
      expect(fit.displayWidth).toBe(400);
      expect(fit.displayHeight).toBe(200);
      expect(fit.offsetX).toBe(0);
      expect(fit.offsetY).toBe(0);
    });
  });

  describe('cover mode', () => {
    it('fills container completely (may crop)', () => {
      const fit = calculateFit(2480, 3508, 800, 600, 'cover');
      // Width-limited: scale = 800/2480 ≈ 0.323
      expect(fit.displayWidth).toBeGreaterThanOrEqual(800);
      expect(fit.displayHeight).toBeGreaterThanOrEqual(600);
      // Negative offset means cropping
      expect(fit.offsetY).toBeLessThanOrEqual(0);
    });

    it('exact aspect ratio has no cropping', () => {
      const fit = calculateFit(100, 100, 200, 200, 'cover');
      expect(fit.displayWidth).toBe(200);
      expect(fit.displayHeight).toBe(200);
      expect(fit.offsetX).toBe(0);
      expect(fit.offsetY).toBe(0);
    });
  });

  describe('defaults', () => {
    it('defaults to contain mode', () => {
      const fit = calculateFit(2480, 3508, 800, 600);
      const explicit = calculateFit(2480, 3508, 800, 600, 'contain');
      expect(fit).toEqual(explicit);
    });
  });

  describe('validation', () => {
    it('rejects zero/negative source dimensions', () => {
      expect(() => calculateFit(0, 100, 800, 600)).toThrow(RangeError);
      expect(() => calculateFit(100, -1, 800, 600)).toThrow(RangeError);
    });

    it('rejects zero/negative container dimensions', () => {
      expect(() => calculateFit(100, 100, 0, 600)).toThrow(RangeError);
      expect(() => calculateFit(100, 100, 800, -1)).toThrow(RangeError);
    });
  });
});
