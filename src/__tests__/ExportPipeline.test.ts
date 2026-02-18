import { describe, it, expect, vi } from 'vitest';
import { decode } from 'fast-png';
import {
  exportBuffer,
  attachExportPipeline,
  generateFilename,
  type ExportableCanvas,
  type ExportOptions,
} from '../export/ExportPipeline.js';
import { ColorBuffer, type IColorBuffer } from '../core/ColorBuffer.js';

// ─── Helper: create a test buffer with known HDR content ─────────────

function makeTestBuffer(w: number, h: number, depth: 32 | 64 = 32): ColorBuffer {
  const buf = new ColorBuffer(w, h, depth);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Gradient: R increases left→right, G increases top→bottom
      // Some HDR values (>1.0) to exercise tone mapping
      const r = (x / Math.max(w - 1, 1)) * 2.0; // 0.0 → 2.0 (HDR)
      const g = (y / Math.max(h - 1, 1)) * 1.5; // 0.0 → 1.5 (HDR)
      const b = 0.3;
      buf.setPixel(x, y, r, g, b, 1.0);
    }
  }
  return buf;
}

// ─── Helper: mock ExportableCanvas ───────────────────────────────────

function makeMockCanvas(w: number, h: number, dpi: number = 300): ExportableCanvas & { exportFn: any } {
  const buffer = makeTestBuffer(w, h);
  let exportFn: any = null;
  return {
    buffer,
    dpi,
    setExportFn(fn: (buffer: IColorBuffer, options: ExportOptions) => Promise<Blob>) {
      exportFn = fn;
    },
    get exportFn() { return exportFn; },
  };
}

// ─── exportBuffer ────────────────────────────────────────────────────

describe('exportBuffer', () => {
  it('produces a valid PNG Blob from a small buffer', () => {
    const buf = makeTestBuffer(4, 4);
    const blob = exportBuffer(buf, { dpi: 300 });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('uses reinhard tone mapping by default', async () => {
    const buf = new ColorBuffer(1, 1, 32);
    buf.setPixel(0, 0, 1.0, 0.0, 0.0, 1.0); // reinhard(1.0) = 0.5

    const blob = exportBuffer(buf, { dpi: 300, gamma: 1 });
    const arrayBuf = await blob.arrayBuffer();
    const decoded = decode(new Uint8Array(arrayBuf));

    // reinhard(1.0) = 0.5 → 128 (with gamma=1)
    expect(decoded.data[0]).toBe(128);
  });

  it('respects toneMap option', async () => {
    const buf = new ColorBuffer(1, 1, 32);
    buf.setPixel(0, 0, 2.0, 0.0, 0.0, 1.0);

    // clamp: 2.0 → 1.0 → 255
    const blobClamp = exportBuffer(buf, { dpi: 300, toneMap: 'clamp', gamma: 1 });
    const decodedClamp = decode(new Uint8Array(await blobClamp.arrayBuffer()));
    expect(decodedClamp.data[0]).toBe(255);

    // reinhard: 2.0 → 2/3 ≈ 0.667 → 170
    const blobReinhard = exportBuffer(buf, { dpi: 300, toneMap: 'reinhard', gamma: 1 });
    const decodedReinhard = decode(new Uint8Array(await blobReinhard.arrayBuffer()));
    expect(decodedReinhard.data[0]).toBe(170);
  });

  it('respects exposure option', async () => {
    const buf = new ColorBuffer(1, 1, 32);
    buf.setPixel(0, 0, 0.25, 0.0, 0.0, 1.0);

    // exposure +1 doubles: 0.25 * 2 = 0.5, clamp → 0.5 → 128
    const blob = exportBuffer(buf, { dpi: 300, toneMap: 'clamp', exposure: 1, gamma: 1 });
    const decoded = decode(new Uint8Array(await blob.arrayBuffer()));
    expect(decoded.data[0]).toBe(128);
  });

  it('respects gamma option', async () => {
    const buf = new ColorBuffer(1, 1, 32);
    buf.setPixel(0, 0, 0.5, 0.0, 0.0, 1.0);

    // gamma=1: 0.5 → 128
    const blob1 = exportBuffer(buf, { dpi: 300, toneMap: 'clamp', gamma: 1 });
    const decoded1 = decode(new Uint8Array(await blob1.arrayBuffer()));
    expect(decoded1.data[0]).toBe(128);

    // gamma=2.2: 0.5^(1/2.2) ≈ 0.7297 → 186
    const blob22 = exportBuffer(buf, { dpi: 300, toneMap: 'clamp', gamma: 2.2 });
    const decoded22 = decode(new Uint8Array(await blob22.arrayBuffer()));
    expect(decoded22.data[0]).toBe(Math.round(Math.pow(0.5, 1 / 2.2) * 255));
  });

  it('embeds correct DPI in the PNG', async () => {
    const buf = makeTestBuffer(2, 2);
    const blob = exportBuffer(buf, { dpi: 150 });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Find pHYs chunk and verify DPI
    let found = false;
    for (let i = 0; i < bytes.length - 4; i++) {
      if (bytes[i] === 0x70 && bytes[i + 1] === 0x48 &&
          bytes[i + 2] === 0x59 && bytes[i + 3] === 0x73) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + i + 4, 9);
        const ppm = view.getUint32(0, false);
        // 150 DPI = 5906 pixels/meter
        expect(ppm).toBe(5906);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('calls progress callback at expected stages', () => {
    const buf = makeTestBuffer(4, 4);
    const progress: number[] = [];

    exportBuffer(buf, {
      dpi: 300,
      onProgress: (p) => progress.push(p),
    });

    expect(progress).toContain(0);
    expect(progress).toContain(50);
    expect(progress).toContain(90);
    expect(progress).toContain(100);
    // Should be in order
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });

  it('rejects unsupported format', () => {
    const buf = makeTestBuffer(2, 2);
    expect(() => exportBuffer(buf, { dpi: 300, format: 'tiff' as any }))
      .toThrow(/Unsupported export format/);
  });

  it('works with Float64 buffers', () => {
    const buf = makeTestBuffer(4, 4, 64);
    const blob = exportBuffer(buf, { dpi: 300 });
    expect(blob.size).toBeGreaterThan(0);
  });
});

// ─── attachExportPipeline ────────────────────────────────────────────

describe('attachExportPipeline', () => {
  it('registers an export function on the canvas', () => {
    const canvas = makeMockCanvas(4, 4);
    expect(canvas.exportFn).toBeNull();

    attachExportPipeline(canvas);
    expect(canvas.exportFn).toBeInstanceOf(Function);
  });

  it('registered function produces valid PNG', async () => {
    const canvas = makeMockCanvas(4, 4, 300);
    attachExportPipeline(canvas);

    const blob = await canvas.exportFn(canvas.buffer, {});
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');

    const decoded = decode(new Uint8Array(await blob.arrayBuffer()));
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
  });

  it('passes export options through to the pipeline', async () => {
    const buf = new ColorBuffer(1, 1, 32);
    buf.setPixel(0, 0, 2.0, 0.0, 0.0, 1.0);

    const canvas: ExportableCanvas & { exportFn: any } = {
      buffer: buf,
      dpi: 300,
      exportFn: null,
      setExportFn(fn) { this.exportFn = fn; },
    };

    attachExportPipeline(canvas);

    // With clamp + gamma=1: 2.0 → clamped to 1.0 → 255
    const blob = await canvas.exportFn(canvas.buffer, { toneMap: 'clamp', gamma: 1 });
    const decoded = decode(new Uint8Array(await blob.arrayBuffer()));
    expect(decoded.data[0]).toBe(255);
  });

  it('uses canvas.dpi for the PNG metadata', async () => {
    const canvas = makeMockCanvas(2, 2, 600);
    attachExportPipeline(canvas);

    const blob = await canvas.exportFn(canvas.buffer, {});
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Find pHYs and check 600 DPI = 23622 ppm
    for (let i = 0; i < bytes.length - 4; i++) {
      if (bytes[i] === 0x70 && bytes[i + 1] === 0x48 &&
          bytes[i + 2] === 0x59 && bytes[i + 3] === 0x73) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + i + 4, 9);
        expect(view.getUint32(0, false)).toBe(23622);
        break;
      }
    }
  });

  it('forwards progress callback', async () => {
    const canvas = makeMockCanvas(4, 4);
    const progress: number[] = [];

    attachExportPipeline(canvas, (p) => progress.push(p));

    await canvas.exportFn(canvas.buffer, {});
    expect(progress.length).toBeGreaterThan(0);
    expect(progress).toContain(100);
  });
});

// ─── generateFilename ────────────────────────────────────────────────

describe('generateFilename', () => {
  it('generates default filename', () => {
    expect(generateFilename(3508, 4961, 300)).toBe('artwork-3508x4961-300dpi.png');
  });

  it('accepts custom prefix', () => {
    expect(generateFilename(2480, 3508, 300, 'flow-field')).toBe('flow-field-2480x3508-300dpi.png');
  });
});

// ─── End-to-end integration test ─────────────────────────────────────

describe('end-to-end', () => {
  it('full pipeline: create buffer → draw HDR → tone map → export → valid PNG', async () => {
    // Simulate what a user would do
    const width = 100;
    const height = 100;
    const dpi = 300;

    // 1. Create buffer (simulating HDCanvas)
    const buffer = new ColorBuffer(width, height, 32);

    // 2. Draw some HDR content — a radial gradient with super-brights
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - width / 2;
        const dy = y - height / 2;
        const dist = Math.sqrt(dx * dx + dy * dy) / (width / 2);
        // Center is super-bright (HDR), edges are dark
        const intensity = Math.max(0, 3.0 * (1 - dist));
        buffer.setPixel(x, y, intensity, intensity * 0.8, intensity * 0.3, 1.0);
      }
    }

    // 3. Export with ACES tone mapping
    const blob = exportBuffer(buffer, {
      dpi,
      toneMap: 'aces',
      exposure: 0.5,
      gamma: 2.2,
    });

    // 4. Verify the output
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const decoded = decode(bytes);

    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);

    // Center pixel should be bright (HDR → tone mapped)
    const centerIdx = (50 * width + 50) * 4;
    expect(decoded.data[centerIdx]).toBeGreaterThan(200);     // R: bright
    expect(decoded.data[centerIdx + 3]).toBe(255);            // A: full

    // Corner pixel should be dark
    const cornerIdx = 0;
    expect(decoded.data[cornerIdx]).toBeLessThan(50);         // R: dark

    // Verify DPI metadata
    let foundDpi = false;
    for (let i = 0; i < bytes.length - 4; i++) {
      if (bytes[i] === 0x70 && bytes[i + 1] === 0x48 &&
          bytes[i + 2] === 0x59 && bytes[i + 3] === 0x73) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + i + 4, 9);
        expect(view.getUint32(0, false)).toBe(11811); // 300 DPI
        foundDpi = true;
        break;
      }
    }
    expect(foundDpi).toBe(true);
  });
});
