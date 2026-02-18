import { describe, it, expect } from 'vitest';
import {
  ToneMapper,
  clamp,
  reinhard,
  aces,
  type ToneMapFn,
} from '../export/ToneMapper.js';
import { ColorBuffer } from '../core/ColorBuffer.js';

// ─── Algorithm unit tests ────────────────────────────────────────────

describe('clamp', () => {
  it('passes through values in [0, 1]', () => {
    expect(clamp(0)).toBe(0);
    expect(clamp(0.5)).toBe(0.5);
    expect(clamp(1)).toBe(1);
  });

  it('clamps negative values to 0', () => {
    expect(clamp(-0.5)).toBe(0);
    expect(clamp(-100)).toBe(0);
  });

  it('clamps values > 1 to 1', () => {
    expect(clamp(1.5)).toBe(1);
    expect(clamp(100)).toBe(1);
  });
});

describe('reinhard', () => {
  it('maps 0 → 0', () => {
    expect(reinhard(0)).toBe(0);
  });

  it('maps 1 → 0.5', () => {
    expect(reinhard(1)).toBe(0.5);
  });

  it('asymptotically approaches 1 for large values', () => {
    expect(reinhard(100)).toBeCloseTo(0.9901, 3);
    expect(reinhard(1000)).toBeCloseTo(0.999, 2);
  });

  it('clamps negative values to 0', () => {
    expect(reinhard(-1)).toBe(0);
  });

  it('never exceeds 1', () => {
    expect(reinhard(1e10)).toBeLessThan(1);
  });
});

describe('aces', () => {
  it('maps 0 → near 0', () => {
    expect(aces(0)).toBeCloseTo(0, 2);
  });

  it('maps 1 to a reasonable mid-tone', () => {
    const result = aces(1);
    expect(result).toBeGreaterThan(0.5);
    expect(result).toBeLessThan(1);
  });

  it('clamps negative values to 0', () => {
    expect(aces(-1)).toBe(0);
  });

  it('approaches 1 for large values', () => {
    expect(aces(100)).toBeCloseTo(1, 2);
  });

  it('result is always in [0, 1]', () => {
    for (const v of [0, 0.01, 0.1, 0.5, 1, 2, 5, 10, 100, 1000]) {
      const result = aces(v);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});

// ─── ToneMapper class tests ─────────────────────────────────────────

describe('ToneMapper', () => {
  describe('construction', () => {
    it('accepts named algorithms', () => {
      expect(() => new ToneMapper({ algorithm: 'clamp' })).not.toThrow();
      expect(() => new ToneMapper({ algorithm: 'reinhard' })).not.toThrow();
      expect(() => new ToneMapper({ algorithm: 'aces' })).not.toThrow();
    });

    it('accepts custom algorithm function', () => {
      const custom: ToneMapFn = (v) => Math.sqrt(v);
      expect(() => new ToneMapper({ algorithm: custom })).not.toThrow();
    });

    it('rejects unknown algorithm name', () => {
      expect(
        () => new ToneMapper({ algorithm: 'bogus' as any })
      ).toThrow(/Unknown tone map algorithm/);
    });

    it('rejects non-positive gamma', () => {
      expect(
        () => new ToneMapper({ algorithm: 'clamp', gamma: 0 })
      ).toThrow(/Gamma must be positive/);
      expect(
        () => new ToneMapper({ algorithm: 'clamp', gamma: -1 })
      ).toThrow(/Gamma must be positive/);
    });

    it('rejects invalid output depth', () => {
      expect(
        () => new ToneMapper({ algorithm: 'clamp', outputDepth: 12 as any })
      ).toThrow(/Output depth must be 8 or 16/);
    });
  });

  describe('mapValue (single channel)', () => {
    it('clamp with no exposure/gamma=1 passes through [0,1]', () => {
      const tm = new ToneMapper({ algorithm: 'clamp', gamma: 1 });
      expect(tm.mapValue(0)).toBeCloseTo(0);
      expect(tm.mapValue(0.5)).toBeCloseTo(0.5);
      expect(tm.mapValue(1)).toBeCloseTo(1);
    });

    it('exposure +1 doubles the value before mapping', () => {
      const tm = new ToneMapper({ algorithm: 'clamp', exposure: 1, gamma: 1 });
      expect(tm.mapValue(0.25)).toBeCloseTo(0.5); // 0.25 * 2 = 0.5
      expect(tm.mapValue(0.5)).toBeCloseTo(1);    // 0.5 * 2 = 1.0 (clamped)
    });

    it('exposure -1 halves the value before mapping', () => {
      const tm = new ToneMapper({ algorithm: 'clamp', exposure: -1, gamma: 1 });
      expect(tm.mapValue(1.0)).toBeCloseTo(0.5); // 1.0 * 0.5 = 0.5
    });

    it('gamma 2.2 applies sRGB-like correction', () => {
      const tm = new ToneMapper({ algorithm: 'clamp', gamma: 2.2 });
      // 0.5^(1/2.2) ≈ 0.7297
      expect(tm.mapValue(0.5)).toBeCloseTo(Math.pow(0.5, 1 / 2.2), 4);
    });

    it('reinhard with exposure compresses HDR correctly', () => {
      const tm = new ToneMapper({ algorithm: 'reinhard', exposure: 0, gamma: 1 });
      // reinhard(2) = 2/3 ≈ 0.6667
      expect(tm.mapValue(2)).toBeCloseTo(2 / 3, 4);
    });
  });

  describe('quantize', () => {
    it('8-bit: 0→0, 0.5→128, 1→255', () => {
      const tm = new ToneMapper({ algorithm: 'clamp', outputDepth: 8 });
      expect(tm.quantize(0)).toBe(0);
      expect(tm.quantize(0.5)).toBe(128);
      expect(tm.quantize(1)).toBe(255);
    });

    it('16-bit: 0→0, 0.5→32768, 1→65535', () => {
      const tm = new ToneMapper({ algorithm: 'clamp', outputDepth: 16 });
      expect(tm.quantize(0)).toBe(0);
      expect(tm.quantize(0.5)).toBe(32768);
      expect(tm.quantize(1)).toBe(65535);
    });

    it('clamps out-of-range values', () => {
      const tm = new ToneMapper({ algorithm: 'clamp', outputDepth: 8 });
      expect(tm.quantize(-0.5)).toBe(0);
      expect(tm.quantize(1.5)).toBe(255);
    });
  });

  describe('map (full buffer)', () => {
    it('produces Uint8Array for 8-bit output', () => {
      const buf = new ColorBuffer(2, 2, 32);
      const tm = new ToneMapper({ algorithm: 'clamp', outputDepth: 8 });
      const result = tm.map(buf);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(2 * 2 * 4);
    });

    it('produces Uint16Array for 16-bit output', () => {
      const buf = new ColorBuffer(2, 2, 32);
      const tm = new ToneMapper({ algorithm: 'clamp', outputDepth: 16 });
      const result = tm.map(buf);
      expect(result).toBeInstanceOf(Uint16Array);
      expect(result.length).toBe(2 * 2 * 4);
    });

    it('correctly maps known HDR values with clamp', () => {
      const buf = new ColorBuffer(2, 1, 32);
      // Pixel 0: standard range
      buf.setPixel(0, 0, 0.5, 0.25, 0.75, 1.0);
      // Pixel 1: HDR super-bright
      buf.setPixel(1, 0, 2.0, 3.0, 0.0, 0.8);

      const tm = new ToneMapper({ algorithm: 'clamp', gamma: 1, outputDepth: 8 });
      const result = tm.map(buf);

      // Pixel 0: 0.5→128, 0.25→64, 0.75→191, alpha 1.0→255
      expect(result[0]).toBe(128);
      expect(result[1]).toBe(64);
      expect(result[2]).toBe(191);
      expect(result[3]).toBe(255);

      // Pixel 1: 2.0→clamped to 255, 3.0→255, 0.0→0, alpha 0.8→204
      expect(result[4]).toBe(255);
      expect(result[5]).toBe(255);
      expect(result[6]).toBe(0);
      expect(result[7]).toBe(204);
    });

    it('correctly maps known HDR values with reinhard', () => {
      const buf = new ColorBuffer(1, 1, 32);
      buf.setPixel(0, 0, 1.0, 4.0, 0.0, 1.0);

      const tm = new ToneMapper({ algorithm: 'reinhard', gamma: 1, outputDepth: 8 });
      const result = tm.map(buf);

      // reinhard(1.0) = 0.5 → 128
      expect(result[0]).toBe(128);
      // reinhard(4.0) = 4/5 = 0.8 → 204
      expect(result[1]).toBe(204);
      // reinhard(0.0) = 0 → 0
      expect(result[2]).toBe(0);
      // alpha: 1.0 → 255
      expect(result[3]).toBe(255);
    });

    it('correctly maps known HDR values with aces', () => {
      const buf = new ColorBuffer(1, 1, 32);
      buf.setPixel(0, 0, 0.0, 1.0, 10.0, 1.0);

      const tm = new ToneMapper({ algorithm: 'aces', gamma: 1, outputDepth: 8 });
      const result = tm.map(buf);

      // aces(0) ≈ 0.214 (due to b/e constants) — actually let's compute:
      // aces(0) = (0*(2.51*0+0.03)) / (0*(2.43*0+0.59)+0.14) = 0/0.14 = 0
      expect(result[0]).toBe(0);
      // aces(1) = (1*(2.51+0.03)) / (1*(2.43+0.59)+0.14) = 2.54/3.16 ≈ 0.8038
      expect(result[1]).toBe(Math.round(aces(1) * 255));
      // aces(10) should be very close to 1
      expect(result[2]).toBeGreaterThan(250);
      expect(result[3]).toBe(255);
    });

    it('alpha is NOT tone-mapped, only clamped', () => {
      const buf = new ColorBuffer(1, 1, 32);
      // Alpha > 1.0 should be clamped, not reinhard-mapped
      buf.setPixel(0, 0, 0.5, 0.5, 0.5, 1.5);

      const tm = new ToneMapper({ algorithm: 'reinhard', gamma: 1, outputDepth: 8 });
      const result = tm.map(buf);

      // Alpha 1.5 → clamped to 1.0 → 255 (NOT reinhard(1.5) = 0.6 → 153)
      expect(result[3]).toBe(255);
    });

    it('works with Float64 buffers', () => {
      const buf = new ColorBuffer(1, 1, 64);
      buf.setPixel(0, 0, 0.5, 0.5, 0.5, 1.0);

      const tm = new ToneMapper({ algorithm: 'clamp', gamma: 1, outputDepth: 8 });
      const result = tm.map(buf);

      expect(result[0]).toBe(128);
      expect(result[1]).toBe(128);
      expect(result[2]).toBe(128);
      expect(result[3]).toBe(255);
    });

    it('handles all-zero buffer', () => {
      const buf = new ColorBuffer(10, 10, 32);
      const tm = new ToneMapper({ algorithm: 'reinhard', outputDepth: 8 });
      const result = tm.map(buf);

      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBe(0);
      }
    });

    it('supports custom algorithm function', () => {
      const buf = new ColorBuffer(1, 1, 32);
      buf.setPixel(0, 0, 4.0, 4.0, 4.0, 1.0);

      // Custom: square root compression
      const sqrt: ToneMapFn = (v) => Math.min(1, Math.sqrt(v));
      const tm = new ToneMapper({ algorithm: sqrt, gamma: 1, outputDepth: 8 });
      const result = tm.map(buf);

      // sqrt(4) = 2, clamped to 1 → 255
      expect(result[0]).toBe(255);
    });
  });

  describe('performance', () => {
    it('handles A4 @ 300 DPI in < 2 seconds', () => {
      // A4 @ 300 DPI = 2480 × 3508 = ~8.7M pixels
      const width = 2480;
      const height = 3508;
      const buf = new ColorBuffer(width, height, 32);

      // Fill with some HDR data
      const data = buf.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.random() * 3;     // R: HDR range
        data[i + 1] = Math.random() * 3; // G
        data[i + 2] = Math.random() * 3; // B
        data[i + 3] = 1.0;               // A
      }

      const tm = new ToneMapper({ algorithm: 'reinhard' });

      const start = performance.now();
      const result = tm.map(buf);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(2000);
      expect(result.length).toBe(width * height * 4);

      // Sanity: all values should be in valid range
      for (let i = 0; i < 100; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(0);
        expect(result[i]).toBeLessThanOrEqual(255);
      }
    });
  });
});
