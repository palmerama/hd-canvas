/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { ColorBuffer } from '../core/ColorBuffer.js';
import { drawWith2D, _internals } from '../bridge/Canvas2DBridge.js';

describe('Canvas2DBridge', () => {
  describe('basic drawing', () => {
    it('draws a filled rect and reads back correct float values', () => {
      const buf = new ColorBuffer(100, 100);
      drawWith2D(buf, (ctx) => {
        ctx.fillStyle = 'rgb(255, 0, 0)';
        ctx.fillRect(0, 0, 100, 100);
      });

      const [r, g, b, a] = buf.getPixel(50, 50);
      expect(r).toBeCloseTo(1.0, 1);
      expect(g).toBeCloseTo(0.0, 1);
      expect(b).toBeCloseTo(0.0, 1);
      expect(a).toBeCloseTo(1.0, 1);
    });

    it('converts 8-bit values to 0.0–1.0 range', () => {
      const buf = new ColorBuffer(10, 10);
      drawWith2D(buf, (ctx) => {
        ctx.fillStyle = 'rgb(128, 64, 192)';
        ctx.fillRect(0, 0, 10, 10);
      });

      const [r, g, b, a] = buf.getPixel(5, 5);
      expect(r).toBeCloseTo(128 / 255, 2);
      expect(g).toBeCloseTo(64 / 255, 2);
      expect(b).toBeCloseTo(192 / 255, 2);
      expect(a).toBeCloseTo(1.0, 2);
    });

    it('handles transparent areas', () => {
      const buf = new ColorBuffer(100, 100);
      // Don't draw anything — canvas defaults to transparent
      drawWith2D(buf, (_ctx) => {
        // no-op
      });

      const [r, g, b, a] = buf.getPixel(50, 50);
      expect(r).toBe(0);
      expect(g).toBe(0);
      expect(b).toBe(0);
      expect(a).toBe(0);
    });

    it('supports partial drawing (not all pixels filled)', () => {
      const buf = new ColorBuffer(100, 100);
      buf.clear(0.5, 0.5, 0.5, 1.0); // grey background

      drawWith2D(buf, (ctx) => {
        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.fillRect(10, 10, 20, 20); // small white square
      });

      // Inside the drawn rect: white
      const [r1] = buf.getPixel(15, 15);
      expect(r1).toBeCloseTo(1.0, 1);

      // Outside the drawn rect: overwritten with transparent (overwrite mode)
      const [r2, g2, b2, a2] = buf.getPixel(0, 0);
      expect(a2).toBe(0); // overwrite mode replaces everything
    });
  });

  describe('overwrite mode (default)', () => {
    it('replaces existing buffer content', () => {
      const buf = new ColorBuffer(50, 50);
      buf.clear(1, 0, 0, 1); // red

      drawWith2D(buf, (ctx) => {
        ctx.fillStyle = 'rgb(0, 0, 255)';
        ctx.fillRect(0, 0, 50, 50);
      });

      const [r, , b] = buf.getPixel(25, 25);
      expect(r).toBeCloseTo(0, 1);
      expect(b).toBeCloseTo(1.0, 1);
    });
  });

  describe('blend mode', () => {
    it('alpha composites onto existing content', () => {
      const buf = new ColorBuffer(50, 50);
      buf.clear(1, 0, 0, 1); // solid red

      drawWith2D(buf, (ctx) => {
        ctx.fillStyle = 'rgba(0, 0, 255, 0.5)';
        ctx.fillRect(0, 0, 50, 50);
      }, { mode: 'blend' });

      const [r, , b, a] = buf.getPixel(25, 25);
      // Blue blended over red at 50% alpha
      expect(a).toBeCloseTo(1.0, 1);
      expect(r).toBeGreaterThan(0.1); // some red remains
      expect(b).toBeGreaterThan(0.1); // some blue added
    });

    it('skips fully transparent pixels in blend mode', () => {
      const buf = new ColorBuffer(50, 50);
      buf.clear(1, 0, 0, 1); // solid red

      drawWith2D(buf, (ctx) => {
        // Only draw in a small area
        ctx.fillStyle = 'rgb(0, 255, 0)';
        ctx.fillRect(10, 10, 10, 10);
      }, { mode: 'blend' });

      // Untouched area should still be red
      const [r, g] = buf.getPixel(0, 0);
      expect(r).toBeCloseTo(1.0, 1);
      expect(g).toBeCloseTo(0, 1);

      // Drawn area should be green
      const [r2, g2] = buf.getPixel(15, 15);
      expect(r2).toBeCloseTo(0, 1);
      expect(g2).toBeCloseTo(1.0, 1);
    });
  });

  describe('region support', () => {
    it('draws only within the specified region', () => {
      const buf = new ColorBuffer(100, 100);
      buf.clear(1, 0, 0, 1); // red everywhere

      drawWith2D(buf, (ctx) => {
        ctx.fillStyle = 'rgb(0, 255, 0)';
        ctx.fillRect(20, 20, 60, 60); // draw green in canvas coords
      }, { region: { x: 20, y: 20, width: 60, height: 60 } });

      // Inside region: green
      const [r1, g1] = buf.getPixel(50, 50);
      expect(g1).toBeCloseTo(1.0, 1);

      // Outside region: still red (untouched)
      const [r2, g2] = buf.getPixel(5, 5);
      expect(r2).toBeCloseTo(1.0, 1);
      expect(g2).toBeCloseTo(0, 1);
    });

    it('rejects out-of-bounds regions', () => {
      const buf = new ColorBuffer(100, 100);
      expect(() => {
        drawWith2D(buf, () => {}, { region: { x: 50, y: 50, width: 60, height: 60 } });
      }).toThrow(RangeError);
    });

    it('rejects zero/negative region dimensions', () => {
      const buf = new ColorBuffer(100, 100);
      expect(() => {
        drawWith2D(buf, () => {}, { region: { x: 0, y: 0, width: 0, height: 50 } });
      }).toThrow(RangeError);
      expect(() => {
        drawWith2D(buf, () => {}, { region: { x: 0, y: 0, width: 50, height: -10 } });
      }).toThrow(RangeError);
    });
  });

  describe('tiling', () => {
    it('tiles when buffer exceeds MAX_TILE_SIZE', () => {
      // Create a buffer larger than the tile size
      const tileSize = _internals.MAX_TILE_SIZE;
      const w = tileSize + 100;
      const h = tileSize + 100;
      const buf = new ColorBuffer(w, h);

      let callCount = 0;
      drawWith2D(buf, (ctx) => {
        callCount++;
        ctx.fillStyle = 'rgb(255, 0, 0)';
        ctx.fillRect(0, 0, w, h);
      });

      // Should be called multiple times (once per tile)
      // (tileSize+100) needs 2 tiles in each dimension = 4 tiles
      expect(callCount).toBe(4);

      // Check pixels in each quadrant
      const [r1] = buf.getPixel(10, 10); // top-left tile
      expect(r1).toBeCloseTo(1.0, 1);

      const [r2] = buf.getPixel(tileSize + 50, 10); // top-right tile
      expect(r2).toBeCloseTo(1.0, 1);

      const [r3] = buf.getPixel(10, tileSize + 50); // bottom-left tile
      expect(r3).toBeCloseTo(1.0, 1);

      const [r4] = buf.getPixel(tileSize + 50, tileSize + 50); // bottom-right tile
      expect(r4).toBeCloseTo(1.0, 1);
    });

    it('does not tile when buffer fits in one tile', () => {
      const buf = new ColorBuffer(100, 100);
      let callCount = 0;
      drawWith2D(buf, (ctx) => {
        callCount++;
        ctx.fillStyle = 'rgb(0, 255, 0)';
        ctx.fillRect(0, 0, 100, 100);
      });
      expect(callCount).toBe(1);
    });

    it('tiles correctly with coordinates spanning tile boundaries', () => {
      const tileSize = _internals.MAX_TILE_SIZE;
      const w = tileSize * 2;
      const h = 100;
      const buf = new ColorBuffer(w, h);

      // Draw a line that spans the tile boundary
      drawWith2D(buf, (ctx) => {
        ctx.fillStyle = 'rgb(0, 0, 255)';
        ctx.fillRect(tileSize - 10, 0, 20, h); // straddles boundary
      });

      // Check pixels on both sides of the boundary
      const [, , b1] = buf.getPixel(tileSize - 5, 50);
      expect(b1).toBeCloseTo(1.0, 1);

      const [, , b2] = buf.getPixel(tileSize + 5, 50);
      expect(b2).toBeCloseTo(1.0, 1);
    });
  });

  describe('Float64 support', () => {
    it('works with Float64 buffers', () => {
      const buf = new ColorBuffer(50, 50, 64);
      drawWith2D(buf, (ctx) => {
        ctx.fillStyle = 'rgb(100, 150, 200)';
        ctx.fillRect(0, 0, 50, 50);
      });

      const [r, g, b] = buf.getPixel(25, 25);
      expect(r).toBeCloseTo(100 / 255, 2);
      expect(g).toBeCloseTo(150 / 255, 2);
      expect(b).toBeCloseTo(200 / 255, 2);
    });
  });

  describe('Canvas 2D features', () => {
    it('supports stroke operations', () => {
      const buf = new ColorBuffer(100, 100);
      drawWith2D(buf, (ctx) => {
        ctx.strokeStyle = 'rgb(255, 255, 0)';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(0, 50);
        ctx.lineTo(100, 50);
        ctx.stroke();
      });

      // Center of the line should be yellow
      const [r, g, b, a] = buf.getPixel(50, 50);
      expect(r).toBeCloseTo(1.0, 1);
      expect(g).toBeCloseTo(1.0, 1);
      expect(b).toBeCloseTo(0, 1);
      expect(a).toBeCloseTo(1.0, 1);
    });

    it('supports arc/circle drawing', () => {
      const buf = new ColorBuffer(100, 100);
      drawWith2D(buf, (ctx) => {
        ctx.fillStyle = 'rgb(0, 255, 255)';
        ctx.beginPath();
        ctx.arc(50, 50, 30, 0, Math.PI * 2);
        ctx.fill();
      });

      // Center of circle should be cyan
      const [r, g, b] = buf.getPixel(50, 50);
      expect(r).toBeCloseTo(0, 1);
      expect(g).toBeCloseTo(1.0, 1);
      expect(b).toBeCloseTo(1.0, 1);
    });
  });
});
