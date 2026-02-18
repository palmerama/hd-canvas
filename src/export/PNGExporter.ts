/**
 * PNGExporter — Full-resolution PNG export with DPI metadata.
 *
 * Takes tone-mapped pixel data (Uint8Array or Uint16Array RGBA) and
 * produces a PNG file with the pHYs chunk set for correct print DPI.
 *
 * Uses fast-png for encoding — pure JS, works in both Node.js and browser.
 * No native dependencies.
 *
 * The pHYs chunk tells image viewers/print software the physical pixel
 * density, so an A3@300DPI image opens at the correct physical size.
 */

import { encode } from 'fast-png';

// ─── Types ───────────────────────────────────────────────────────────

export interface PNGExportOptions {
  /** Pixel width of the image. */
  width: number;
  /** Pixel height of the image. */
  height: number;
  /** DPI for the pHYs metadata chunk. */
  dpi: number;
  /**
   * Bit depth of the input data.
   * 8 → expects Uint8Array, 16 → expects Uint16Array.
   * Default: 8.
   */
  depth?: 8 | 16;
}

export interface PNGExportResult {
  /** Raw PNG file bytes. */
  data: Uint8Array;
  /** MIME type. */
  mimeType: 'image/png';
  /** Suggested filename. */
  filename: string;
}

// ─── DPI conversion ──────────────────────────────────────────────────

/**
 * Convert DPI to pixels-per-meter for the PNG pHYs chunk.
 * 1 inch = 0.0254 meters, so ppm = dpi / 0.0254.
 */
export function dpiToPixelsPerMeter(dpi: number): number {
  return Math.round(dpi / 0.0254);
}

// ─── PNG pHYs chunk injection ────────────────────────────────────────

/**
 * CRC32 lookup table for PNG chunk checksums.
 */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a PNG pHYs chunk.
 *
 * Format: 4 bytes length + 4 bytes "pHYs" + 9 bytes data + 4 bytes CRC
 * Data: 4 bytes X ppm (big-endian) + 4 bytes Y ppm + 1 byte unit (1=meter)
 */
function buildPHYsChunk(dpi: number): Uint8Array {
  const ppm = dpiToPixelsPerMeter(dpi);
  const chunk = new Uint8Array(21); // 4 + 4 + 9 + 4
  const view = new DataView(chunk.buffer);

  // Length of data section (9 bytes)
  view.setUint32(0, 9, false);

  // Chunk type: "pHYs"
  chunk[4] = 0x70; // p
  chunk[5] = 0x48; // H
  chunk[6] = 0x59; // Y
  chunk[7] = 0x73; // s

  // X pixels per unit (big-endian)
  view.setUint32(8, ppm, false);
  // Y pixels per unit (big-endian)
  view.setUint32(12, ppm, false);
  // Unit: 1 = meter
  chunk[16] = 1;

  // CRC over type + data (bytes 4..16 inclusive)
  const crcData = chunk.slice(4, 17);
  const crcVal = crc32(crcData);
  view.setUint32(17, crcVal, false);

  return chunk;
}

/**
 * Inject a pHYs chunk into an existing PNG buffer.
 *
 * PNG structure: signature (8 bytes) → IHDR chunk → ... → IDAT → IEND
 * pHYs must appear before the first IDAT chunk.
 * We insert it right after IHDR (which is always the first chunk).
 */
export function injectPHYs(png: Uint8Array, dpi: number): Uint8Array {
  // PNG signature is 8 bytes
  // IHDR chunk: 4 (length) + 4 (type) + 13 (data) + 4 (crc) = 25 bytes
  // So IHDR ends at byte 33
  const IHDR_END = 8 + 25;

  // Verify this is a PNG
  if (png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) {
    throw new Error('Not a valid PNG file');
  }

  const phys = buildPHYsChunk(dpi);

  // Concatenate: [signature + IHDR] + [pHYs] + [rest of PNG]
  const result = new Uint8Array(png.length + phys.length);
  result.set(png.subarray(0, IHDR_END), 0);
  result.set(phys, IHDR_END);
  result.set(png.subarray(IHDR_END), IHDR_END + phys.length);

  return result;
}

// ─── PNGExporter class ───────────────────────────────────────────────

export class PNGExporter {
  /**
   * Export tone-mapped pixel data to PNG with DPI metadata.
   *
   * @param data - Tone-mapped RGBA pixel data (Uint8Array for 8-bit, Uint16Array for 16-bit)
   * @param options - Export options (width, height, dpi, depth)
   * @returns PNG file data with pHYs chunk embedded
   */
  export(data: Uint8Array | Uint16Array, options: PNGExportOptions): PNGExportResult {
    const { width, height, dpi, depth = 8 } = options;

    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid dimensions: ${width}x${height}`);
    }
    if (dpi <= 0) {
      throw new Error(`DPI must be positive, got: ${dpi}`);
    }

    const expectedLength = width * height * 4;
    if (data.length !== expectedLength) {
      throw new Error(
        `Data length mismatch: expected ${expectedLength} (${width}x${height}x4), got ${data.length}`
      );
    }

    if (depth === 16 && !(data instanceof Uint16Array)) {
      throw new Error('16-bit depth requires Uint16Array input');
    }
    if (depth === 8 && !(data instanceof Uint8Array)) {
      throw new Error('8-bit depth requires Uint8Array input');
    }

    // Encode PNG using fast-png
    const pngBytes = encode({
      width,
      height,
      data,
      depth,
      channels: 4,
    });

    // Inject pHYs chunk for DPI metadata
    const pngWithDpi = injectPHYs(pngBytes, dpi);

    return {
      data: pngWithDpi,
      mimeType: 'image/png',
      filename: `artwork-${width}x${height}-${dpi}dpi.png`,
    };
  }

  /**
   * Export and return as a Blob (browser convenience).
   */
  exportBlob(data: Uint8Array | Uint16Array, options: PNGExportOptions): Blob {
    const result = this.export(data, options);
    // Cast needed: Node.js types have SharedArrayBuffer in ArrayBufferLike
    return new Blob([result.data.buffer as ArrayBuffer], { type: result.mimeType });
  }
}
