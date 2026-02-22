import { describe, it, expect, vi } from 'vitest';
import { HDCanvas } from '../core/HDCanvas.js';

describe('HDCanvas', () => {
  describe('construction', () => {
    it('creates A4 @ 300 DPI with correct pixel dimensions', () => {
      const canvas = new HDCanvas({ paperSize: 'A4' });
      expect(canvas.widthPx).toBe(2480);
      expect(canvas.heightPx).toBe(3508);
      expect(canvas.dpi).toBe(300);
      expect(canvas.colorDepth).toBe(32);
    });

    it('creates A3 @ 600 DPI Float64', () => {
      const canvas = new HDCanvas({ paperSize: 'A3', dpi: 600, colorDepth: 64 });
      expect(canvas.widthPx).toBe(7016);
      expect(canvas.heightPx).toBe(9921);
      expect(canvas.colorDepth).toBe(64);
    });

    it('supports landscape orientation', () => {
      const canvas = new HDCanvas({ paperSize: 'A4', orientation: 'landscape' });
      expect(canvas.widthPx).toBe(3508);
      expect(canvas.heightPx).toBe(2480);
    });

    it('supports custom paper sizes', () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 254, heightMM: 254 },
        dpi: 100,
      });
      expect(canvas.widthPx).toBe(1000);
      expect(canvas.heightPx).toBe(1000);
    });

    it('supports US Letter', () => {
      const canvas = new HDCanvas({ paperSize: 'Letter' });
      expect(canvas.widthPx).toBe(2550);
      expect(canvas.heightPx).toBe(3300);
    });

    it('rejects invalid DPI', () => {
      expect(() => new HDCanvas({ paperSize: 'A4', dpi: 0 })).toThrow(RangeError);
      expect(() => new HDCanvas({ paperSize: 'A4', dpi: -100 })).toThrow(RangeError);
    });

    it('reports memory usage', () => {
      const canvas = new HDCanvas({ paperSize: 'A4' });
      // 2480 × 3508 × 4 channels × 4 bytes (Float32)
      expect(canvas.memoryBytes).toBe(2480 * 3508 * 4 * 4);
    });

    it('stores paper dimensions in mm', () => {
      const canvas = new HDCanvas({ paperSize: 'A4' });
      expect(canvas.paperMM.widthMM).toBe(210);
      expect(canvas.paperMM.heightMM).toBe(297);
    });
  });

  describe('drawing API delegation', () => {
    it('setPixel/getPixel delegates to buffer', () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      }); // 10×10 px
      canvas.setPixel(5, 5, 0.5, 0.6, 0.7, 0.8);
      const [r, g, b, a] = canvas.getPixel(5, 5);
      expect(r).toBeCloseTo(0.5);
      expect(g).toBeCloseTo(0.6);
      expect(b).toBeCloseTo(0.7);
      expect(a).toBeCloseTo(0.8);
    });

    it('clear fills the buffer', () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      canvas.clear(1, 1, 1, 1);
      const [r, g, b, a] = canvas.getPixel(0, 0);
      expect(r).toBe(1);
      expect(g).toBe(1);
      expect(b).toBe(1);
      expect(a).toBe(1);
    });

    it('blendPixel delegates to buffer', () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      canvas.setPixel(0, 0, 1, 0, 0, 1);
      canvas.blendPixel(0, 0, 0, 1, 0, 1, 'normal');
      const [r, g] = canvas.getPixel(0, 0);
      expect(r).toBeCloseTo(0);
      expect(g).toBeCloseTo(1);
    });

    it('getRegion/putRegion delegate to buffer', () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      canvas.setPixel(2, 2, 1, 0, 0, 1);
      const region = canvas.getRegion(2, 2, 3, 3);
      expect(region.getPixel(0, 0)).toEqual([1, 0, 0, 1]);

      canvas.clear();
      canvas.putRegion(5, 5, region);
      expect(canvas.getPixel(5, 5)).toEqual([1, 0, 0, 1]);
    });
  });

  describe('preview', () => {
    it('refreshPreview is a no-op without a renderer', () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      expect(() => canvas.refreshPreview()).not.toThrow();
    });

    it('calls refresh on attached renderer', () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      const renderer = { refresh: vi.fn(), destroy: vi.fn() };
      canvas.setPreviewRenderer(renderer);
      canvas.refreshPreview();
      expect(renderer.refresh).toHaveBeenCalledOnce();
    });

    it('destroys old renderer when replacing', () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      const old = { refresh: vi.fn(), destroy: vi.fn() };
      const next = { refresh: vi.fn(), destroy: vi.fn() };
      canvas.setPreviewRenderer(old);
      canvas.setPreviewRenderer(next);
      expect(old.destroy).toHaveBeenCalledOnce();
    });
  });

  describe('commitFrame', () => {
    it('resolves immediately without a renderer (headless)', async () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      // Should resolve without error and without delay
      await canvas.commitFrame();
    });

    it('calls refresh on attached renderer', async () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      const renderer = { refresh: vi.fn(), destroy: vi.fn() };
      canvas.setPreviewRenderer(renderer);

      // commitFrame triggers refresh
      const promise = canvas.commitFrame();
      expect(renderer.refresh).toHaveBeenCalledOnce();
      await promise;
    });

    it('can be called in a loop without blocking', async () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      const renderer = { refresh: vi.fn(), destroy: vi.fn() };
      canvas.setPreviewRenderer(renderer);

      for (let i = 0; i < 5; i++) {
        canvas.setPixel(0, 0, i / 5, 0, 0, 1);
        await canvas.commitFrame();
      }
      expect(renderer.refresh).toHaveBeenCalledTimes(5);
    });
  });

  describe('export', () => {
    it('throws without an export function', async () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      await expect(canvas.export()).rejects.toThrow('No export function registered');
    });

    it('calls registered export function with buffer and options', async () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      const blob = new Blob(['test']);
      const exportFn = vi.fn().mockResolvedValue(blob);
      canvas.setExportFn(exportFn);

      const result = await canvas.export({ toneMap: 'reinhard', exposure: 1.5 });
      expect(result).toBe(blob);
      expect(exportFn).toHaveBeenCalledWith(canvas.buffer, {
        toneMap: 'reinhard',
        exposure: 1.5,
      });
    });
  });

  describe('destroy', () => {
    it('cleans up renderer and export fn', async () => {
      const canvas = new HDCanvas({
        paperSize: { widthMM: 25.4, heightMM: 25.4 },
        dpi: 10,
      });
      const renderer = { refresh: vi.fn(), destroy: vi.fn() };
      canvas.setPreviewRenderer(renderer);
      canvas.setExportFn(vi.fn());

      canvas.destroy();
      expect(renderer.destroy).toHaveBeenCalledOnce();

      // After destroy, export should fail
      await expect(canvas.export()).rejects.toThrow();
    });
  });
});
