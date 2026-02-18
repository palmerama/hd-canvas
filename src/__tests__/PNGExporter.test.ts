import { describe, it, expect } from 'vitest';
import { decode } from 'fast-png';
import {
  PNGExporter,
  dpiToPixelsPerMeter,
  injectPHYs,
} from '../export/PNGExporter.js';

// ─── DPI conversion ──────────────────────────────────────────────────

describe('dpiToPixelsPerMeter', () => {
  it('converts 300 DPI correctly', () => {
    // 300 / 0.0254 = 11811.02... → 11811
    expect(dpiToPixelsPerMeter(300)).toBe(11811);
  });

  it('converts 72 DPI correctly', () => {
    // 72 / 0.0254 = 2834.64... → 2835
    expect(dpiToPixelsPerMeter(72)).toBe(2835);
  });

  it('converts 150 DPI correctly', () => {
    expect(dpiToPixelsPerMeter(150)).toBe(5906);
  });
});

// ─── PNGExporter ─────────────────────────────────────────────────────

describe('PNGExporter', () => {
  const exporter = new PNGExporter();

  describe('validation', () => {
    it('rejects zero dimensions', () => {
      const data = new Uint8Array(0);
      expect(() => exporter.export(data, { width: 0, height: 10, dpi: 300 }))
        .toThrow(/Invalid dimensions/);
    });

    it('rejects negative DPI', () => {
      const data = new Uint8Array(4);
      expect(() => exporter.export(data, { width: 1, height: 1, dpi: -1 }))
        .toThrow(/DPI must be positive/);
    });

    it('rejects data length mismatch', () => {
      const data = new Uint8Array(8); // 2 pixels, but we say 2x2
      expect(() => exporter.export(data, { width: 2, height: 2, dpi: 300 }))
        .toThrow(/Data length mismatch/);
    });

    it('rejects Uint8Array for 16-bit depth', () => {
      const data = new Uint8Array(4);
      expect(() => exporter.export(data, { width: 1, height: 1, dpi: 300, depth: 16 }))
        .toThrow(/16-bit depth requires Uint16Array/);
    });

    it('rejects Uint16Array for 8-bit depth', () => {
      const data = new Uint16Array(4);
      expect(() => exporter.export(data, { width: 1, height: 1, dpi: 300, depth: 8 }))
        .toThrow(/8-bit depth requires Uint8Array/);
    });
  });

  describe('8-bit export', () => {
    it('produces valid PNG from a 1x1 red pixel', () => {
      const data = new Uint8Array([255, 0, 0, 255]); // red, full alpha
      const result = exporter.export(data, { width: 1, height: 1, dpi: 300 });

      expect(result.mimeType).toBe('image/png');
      expect(result.data.length).toBeGreaterThan(0);

      // Verify it's a valid PNG by decoding it
      const decoded = decode(result.data);
      expect(decoded.width).toBe(1);
      expect(decoded.height).toBe(1);
      expect(decoded.data[0]).toBe(255); // R
      expect(decoded.data[1]).toBe(0);   // G
      expect(decoded.data[2]).toBe(0);   // B
      expect(decoded.data[3]).toBe(255); // A
    });

    it('produces valid PNG from a 4x4 gradient', () => {
      const data = new Uint8Array(4 * 4 * 4);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const i = (y * 4 + x) * 4;
          data[i] = x * 85;     // R: 0, 85, 170, 255
          data[i + 1] = y * 85; // G
          data[i + 2] = 128;    // B
          data[i + 3] = 255;    // A
        }
      }

      const result = exporter.export(data, { width: 4, height: 4, dpi: 300 });
      const decoded = decode(result.data);

      expect(decoded.width).toBe(4);
      expect(decoded.height).toBe(4);

      // Check a few pixels
      expect(decoded.data[0]).toBe(0);   // (0,0) R
      expect(decoded.data[4]).toBe(85);  // (1,0) R
      expect(decoded.data[17]).toBe(85); // (0,1) G
    });

    it('generates sensible filename', () => {
      const data = new Uint8Array(4);
      const result = exporter.export(data, { width: 1, height: 1, dpi: 300 });
      expect(result.filename).toBe('artwork-1x1-300dpi.png');
    });
  });

  describe('16-bit export', () => {
    it('produces valid 16-bit PNG', () => {
      const data = new Uint16Array([65535, 0, 32768, 65535]); // bright red-ish
      const result = exporter.export(data, { width: 1, height: 1, dpi: 300, depth: 16 });

      expect(result.data.length).toBeGreaterThan(0);

      const decoded = decode(result.data);
      expect(decoded.width).toBe(1);
      expect(decoded.height).toBe(1);
      expect(decoded.depth).toBe(16);
      // 16-bit values should round-trip
      expect(decoded.data[0]).toBe(65535);
      expect(decoded.data[1]).toBe(0);
      expect(decoded.data[2]).toBe(32768);
      expect(decoded.data[3]).toBe(65535);
    });
  });

  describe('pHYs DPI metadata', () => {
    it('embeds pHYs chunk in the PNG', () => {
      const data = new Uint8Array([128, 128, 128, 255]);
      const result = exporter.export(data, { width: 1, height: 1, dpi: 300 });

      // Search for "pHYs" in the output
      const png = result.data;
      let foundPHYs = false;
      for (let i = 0; i < png.length - 4; i++) {
        if (png[i] === 0x70 && png[i + 1] === 0x48 &&
            png[i + 2] === 0x59 && png[i + 3] === 0x73) {
          foundPHYs = true;

          // Read X pixels-per-meter (4 bytes big-endian after "pHYs")
          const view = new DataView(png.buffer, png.byteOffset + i + 4, 9);
          const xPPM = view.getUint32(0, false);
          const yPPM = view.getUint32(4, false);
          const unit = view.getUint8(8);

          expect(xPPM).toBe(11811); // 300 DPI
          expect(yPPM).toBe(11811);
          expect(unit).toBe(1); // meters
          break;
        }
      }
      expect(foundPHYs).toBe(true);
    });

    it('pHYs appears before IDAT', () => {
      const data = new Uint8Array([128, 128, 128, 255]);
      const result = exporter.export(data, { width: 1, height: 1, dpi: 300 });
      const png = result.data;

      let physPos = -1;
      let idatPos = -1;

      for (let i = 0; i < png.length - 4; i++) {
        if (png[i] === 0x70 && png[i + 1] === 0x48 &&
            png[i + 2] === 0x59 && png[i + 3] === 0x73) {
          physPos = i;
        }
        if (png[i] === 0x49 && png[i + 1] === 0x44 &&
            png[i + 2] === 0x41 && png[i + 3] === 0x54) {
          idatPos = i;
          break; // first IDAT is what matters
        }
      }

      expect(physPos).toBeGreaterThan(-1);
      expect(idatPos).toBeGreaterThan(-1);
      expect(physPos).toBeLessThan(idatPos);
    });
  });

  describe('performance', () => {
    it('exports a 1000x1000 8-bit PNG in < 2 seconds', () => {
      const w = 1000, h = 1000;
      const data = new Uint8Array(w * h * 4);
      // Fill with a pattern
      for (let i = 0; i < data.length; i += 4) {
        data[i] = (i / 4) % 256;
        data[i + 1] = ((i / 4) >> 8) % 256;
        data[i + 2] = 128;
        data[i + 3] = 255;
      }

      const start = performance.now();
      const result = exporter.export(data, { width: w, height: h, dpi: 300 });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(2000);
      expect(result.data.length).toBeGreaterThan(0);
    });
  });
});
