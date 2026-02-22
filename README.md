# hd-canvas

A TypeScript library for generative art with **HDR color**, configurable **paper sizes**, and **print-quality export**.

Build artwork with unbounded float colors (values > 1.0 = super-bright HDR), preview it on screen with zoom/pan, and export print-ready PNGs at 300+ DPI with embedded resolution metadata.

## Features

- **Float32/Float64 HDR color buffers** — unbounded RGBA values, no 8-bit clamping during creation
- **Paper size presets** — A0–A6, US Letter/Legal/Tabloid with DPI-aware pixel calculations
- **Tone mapping** — Reinhard, ACES filmic, clamp, or custom algorithms to compress HDR → LDR on export
- **Print-ready PNG export** — pHYs chunk injection for correct DPI metadata, 8-bit and 16-bit output
- **Canvas 2D bridge** — draw with the familiar `fillRect`, `arc`, `fillText` API, auto-tiled for large formats
- **Zoom/pan preview** — scroll-wheel zoom centered on cursor, click-drag pan, keyboard shortcuts, visible-region-only rendering
- **Overlay canvases** — layer WebGL, Canvas 2D, or any canvas on top of the preview, perfectly aligned and auto-sized
- **Blend modes** — normal (alpha composite), additive, multiply — layer effects in HDR space
- **Zero native dependencies** — pure JS PNG encoding via `fast-png`, runs in browser and Node.js

## Install

```bash
npm install @palmerama/hd-canvas
```

## Quick Start

```typescript
import {
  HDCanvas,
  attachExportPipeline,
  PreviewRenderer,
} from '@palmerama/hd-canvas';

// 1. Create a canvas — A3 paper at 300 DPI
const canvas = new HDCanvas({ paperSize: 'A3', dpi: 300 });

// 2. Draw with HDR float colors
for (let y = 0; y < canvas.heightPx; y++) {
  for (let x = 0; x < canvas.widthPx; x++) {
    const intensity = Math.random() * 3.0; // HDR: values > 1.0
    canvas.setPixel(x, y, intensity, intensity * 0.6, 0.1, 1.0);
  }
}

// 3. Preview on screen (browser only)
const preview = new PreviewRenderer(canvas, {
  container: document.getElementById('preview')!,
});

// 4. Export print-ready PNG
attachExportPipeline(canvas);
const blob = await canvas.export({ toneMap: 'aces', exposure: 0.5 });
```

## API Reference

### Core

#### `HDCanvas`

The main class. Wraps a `ColorBuffer` with paper size and DPI configuration.

```typescript
const canvas = new HDCanvas({
  paperSize: 'A4',           // or 'A3', 'letter', 'tabloid', etc.
  dpi: 300,                  // default: 300
  colorDepth: 32,            // 32 (Float32) or 64 (Float64), default: 32
  orientation: 'portrait',   // 'portrait' or 'landscape', default: 'portrait'
});

canvas.widthPx;    // pixel width (e.g., 2480 for A4 @ 300 DPI)
canvas.heightPx;   // pixel height (e.g., 3508 for A4 @ 300 DPI)
canvas.dpi;        // configured DPI
canvas.memoryBytes; // buffer memory usage in bytes
```

#### Pixel Drawing

```typescript
// Set a pixel (RGBA, unbounded floats)
canvas.setPixel(x, y, r, g, b, a);

// Read a pixel back
const [r, g, b, a] = canvas.getPixel(x, y);

// Blend onto existing content
canvas.blendPixel(x, y, r, g, b, a, 'normal');  // alpha composite
canvas.blendPixel(x, y, r, g, b, a, 'add');     // additive (glow effects)
canvas.blendPixel(x, y, r, g, b, a, 'multiply'); // multiply (shadows)

// Fill entire buffer
canvas.clear(0, 0, 0, 1); // solid black

// Region operations
const region = canvas.getRegion(x, y, width, height); // extract sub-buffer
canvas.putRegion(x, y, region);                        // paste sub-buffer
```

#### `ColorBuffer`

The raw float pixel buffer. Used directly for advanced operations.

```typescript
import { ColorBuffer } from '@palmerama/hd-canvas';

const buf = new ColorBuffer(1920, 1080, 32); // width, height, depth
buf.setPixel(0, 0, 1.5, 0.3, 0.0, 1.0);    // HDR orange
buf.data; // Float32Array — direct access for bulk operations
```

#### Paper Sizes

```typescript
import { PAPER_SIZES, sizeToPx, resolvePaperSize, estimateBufferBytes } from '@palmerama/hd-canvas';

// All presets: A0–A6, letter, legal, tabloid
PAPER_SIZES.A4;     // { widthMM: 210, heightMM: 297 }
PAPER_SIZES.letter; // { widthMM: 215.9, heightMM: 279.4 }

// Calculate pixel dimensions
sizeToPx({ widthMM: 210, heightMM: 297 }, 300);
// → { width: 2480, height: 3508 }

// Resolve with orientation
resolvePaperSize('A3', 'landscape');
// → { widthMM: 420, heightMM: 297 }

// Estimate memory before allocating
estimateBufferBytes('A0', 300, 32); // ~2.07 GB for Float32
estimateBufferBytes('A0', 300, 64); // ~4.14 GB for Float64
```

### Canvas 2D Bridge

Draw with the familiar Canvas 2D API — shapes, text, paths, gradients — then continue with HDR pixel operations on top.

```typescript
// Draw convenience shapes with Canvas 2D
canvas.drawWith2D((ctx) => {
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.widthPx, canvas.heightPx);

  ctx.strokeStyle = 'white';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(canvas.widthPx / 2, canvas.heightPx / 2, 200, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font = '72px serif';
  ctx.fillStyle = 'white';
  ctx.fillText('Hello HD', 100, 400);
});

// Then layer HDR effects on top
canvas.blendPixel(x, y, 2.0, 0.5, 0.0, 0.8, 'add'); // HDR glow
```

**Options:**

```typescript
canvas.drawWith2D(callback, {
  mode: 'blend',              // 'overwrite' (default) or 'blend'
  blendMode: 'normal',        // 'normal', 'add', or 'multiply' (when mode is 'blend')
  region: { x, y, width, height }, // draw into a sub-region only
});
```

> **Note:** Canvas 2D is 8-bit, so this is for convenience shapes/text. For HDR drawing, use the pixel API directly. Large canvases (A0+) are automatically tiled at 4096px for browser compatibility.

### Preview

Interactive zoom/pan preview for browser environments.

```typescript
import { PreviewRenderer } from '@palmerama/hd-canvas';

const preview = new PreviewRenderer(canvas, {
  container: document.getElementById('preview')!,
});

preview.refresh();       // re-render after drawing changes (rAF batched)
preview.renderFrame();   // synchronous render (bypasses rAF batching)
preview.destroy();       // clean up event listeners
```

**Controls:**
- Scroll wheel: zoom (centered on cursor)
- Click + drag: pan
- `+` / `-` keys: zoom in/out
- `0` key: reset zoom
- Double-click: fit to view

#### Overlay Canvases

Layer additional canvases (WebGL, 2D, etc.) on top of the preview, perfectly aligned with the buffer display area. The library handles positioning, sizing, and resize tracking automatically.

```typescript
// WebGL overlay — e.g., Three.js rendering aligned to the buffer
const glCanvas = preview.createOverlayCanvas({
  blendMode: 'screen',  // CSS mix-blend-mode
  opacity: 1.0,
});
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas });
renderer.setSize(glCanvas.width, glCanvas.height, false);

// 2D overlay — e.g., annotations, UI, drawing
const drawCanvas = preview.createOverlayCanvas({
  opacity: 0.5,
  zIndex: 2,
});
const ctx = drawCanvas.getContext('2d')!;
ctx.fillStyle = 'red';
ctx.fillRect(10, 10, 100, 100); // positioned relative to the buffer
```

The overlay canvas is automatically:
- **Positioned** to match the buffer's display area (including letterbox offsets)
- **Sized** to the buffer's display dimensions (`canvas.width` and `canvas.height` are set for 1:1 pixel mapping)
- **Repositioned** on container resize via the existing `ResizeObserver`
- **Updated** on zoom/pan changes during `refresh()`

**Options:**

```typescript
interface OverlayCanvasOptions {
  opacity?: number;    // CSS opacity, 0–1. Default: 1
  blendMode?: string;  // CSS mix-blend-mode. Default: 'normal'
  visible?: boolean;   // Show/hide. Default: true
  zIndex?: number;     // Stacking order. Default: 1
}
```

**Managing overlays:**

```typescript
// Update options after creation
preview.updateOverlay(glCanvas, { opacity: 0.8, visible: false });

// Remove an overlay
preview.removeOverlayCanvas(glCanvas);

// All overlays are cleaned up automatically on preview.destroy()
```

### Tone Mapping

Compress HDR float values to displayable/exportable range.

```typescript
import { ToneMapper, reinhard, aces, clamp } from '@palmerama/hd-canvas';

// Use standalone functions
reinhard(2.0);  // → 0.667 (smooth compression)
aces(2.0);      // → 0.928 (filmic look)
clamp(2.0);     // → 1.0 (hard clip)

// Or the full pipeline
const mapper = new ToneMapper({
  algorithm: 'aces',    // 'reinhard', 'aces', 'clamp', or custom function
  exposure: 1.0,        // stops: multiply by 2^exposure before mapping
  gamma: 2.2,           // sRGB gamma correction (default: 2.2)
  outputDepth: 8,       // 8 → Uint8Array, 16 → Uint16Array
});

const ldrPixels = mapper.map(canvas.buffer); // Uint8Array RGBA
```

**Custom tone mapping:**

```typescript
const mapper = new ToneMapper({
  algorithm: (v: number) => Math.sqrt(Math.min(1, v)), // square root compression
  gamma: 1.0,
});
```

### Export

Print-ready PNG export with DPI metadata.

```typescript
import { attachExportPipeline, exportBuffer, exportAndDownload } from '@palmerama/hd-canvas';

// Option 1: Attach to HDCanvas (recommended)
attachExportPipeline(canvas);
const blob = await canvas.export({
  toneMap: 'aces',     // tone mapping algorithm
  exposure: 0.5,       // exposure adjustment (stops)
  gamma: 2.2,          // gamma correction
});

// Option 2: Export with progress tracking
attachExportPipeline(canvas, (percent) => {
  console.log(`Export: ${percent}%`);
});

// Option 3: Standalone function (no HDCanvas needed)
const blob2 = exportBuffer(colorBuffer, {
  dpi: 300,
  toneMap: 'reinhard',
  exposure: 0,
  gamma: 2.2,
});

// Option 4: Export + browser download in one call
await exportAndDownload(canvas, { toneMap: 'aces' }, 'my-artwork.png');
```

#### PNG Exporter (low-level)

```typescript
import { PNGExporter, dpiToPixelsPerMeter } from '@palmerama/hd-canvas';

const exporter = new PNGExporter();

// 8-bit export
const result = exporter.export(uint8Data, {
  width: 2480,
  height: 3508,
  dpi: 300,
  depth: 8,
});
// result.data: Uint8Array (raw PNG bytes)
// result.mimeType: 'image/png'
// result.filename: 'artwork-2480x3508-300dpi.png'

// 16-bit export for maximum quality
const result16 = exporter.export(uint16Data, {
  width: 2480,
  height: 3508,
  dpi: 300,
  depth: 16,
});

// DPI conversion utility
dpiToPixelsPerMeter(300); // → 11811
```

## Examples

### Generative Flow Field

```typescript
import { HDCanvas, attachExportPipeline } from '@palmerama/hd-canvas';

const canvas = new HDCanvas({ paperSize: 'A3', dpi: 300 });
canvas.clear(0.02, 0.02, 0.05, 1.0); // near-black background

// Generate flow field with HDR highlights
for (let i = 0; i < 50000; i++) {
  let x = Math.random() * canvas.widthPx;
  let y = Math.random() * canvas.heightPx;

  for (let step = 0; step < 100; step++) {
    const angle = noise2D(x * 0.001, y * 0.001) * Math.PI * 4;
    x += Math.cos(angle) * 2;
    y += Math.sin(angle) * 2;

    if (x < 0 || x >= canvas.widthPx || y < 0 || y >= canvas.heightPx) break;

    // Additive blending creates natural HDR glow at intersections
    canvas.blendPixel(
      Math.floor(x), Math.floor(y),
      0.02, 0.015, 0.03,  // subtle per-step contribution
      0.5,                  // semi-transparent
      'add'                 // accumulates beyond 1.0 = HDR
    );
  }
}

// ACES tone mapping compresses the HDR glow beautifully
attachExportPipeline(canvas);
const blob = await canvas.export({ toneMap: 'aces', exposure: 1.5 });
```

### Layered Composition

```typescript
const canvas = new HDCanvas({ paperSize: 'letter', dpi: 300 });

// Layer 1: Canvas 2D background
canvas.drawWith2D((ctx) => {
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.heightPx);
  grad.addColorStop(0, '#0a0a2e');
  grad.addColorStop(1, '#1a0a3e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.widthPx, canvas.heightPx);
});

// Layer 2: HDR particle system (blend on top)
for (const particle of particles) {
  canvas.blendPixel(
    particle.x, particle.y,
    particle.energy * 2.0,  // HDR intensity
    particle.energy * 0.8,
    particle.energy * 0.3,
    0.6,
    'add'
  );
}

// Layer 3: Canvas 2D text overlay (blend mode preserves HDR underneath)
canvas.drawWith2D((ctx) => {
  ctx.font = 'bold 120px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillText('ENERGY', 100, canvas.heightPx / 2);
}, { mode: 'blend' });
```

### Custom Paper Size

```typescript
const canvas = new HDCanvas({
  paperSize: { widthMM: 300, heightMM: 300 }, // 30cm square
  dpi: 600,  // high quality
  colorDepth: 64,  // Float64 for maximum precision
});
```

### Frame Control

For generative art and animated renders, use `commitFrame()` to pace your render loop:

```typescript
// Producer controls the pace — every frame is guaranteed visible
async function render(canvas: HDCanvas) {
  for (let frame = 0; frame < 1000; frame++) {
    drawMyFrame(canvas, frame);
    await canvas.commitFrame(); // refresh preview, yield to browser
  }
}
```

`commitFrame()` does three things:
1. Triggers a preview refresh (if a renderer is attached)
2. Yields to the browser via `requestAnimationFrame` — giving it time to paint and handle input
3. Returns a Promise that resolves after the next animation frame

If no preview is attached (headless/Node.js), it resolves immediately with zero overhead.

### Performance: Direct Buffer Access

For maximum write throughput, access the typed array directly:

```typescript
// Direct data access — no function call overhead, no bounds checks
const data = canvas.buffer.data; // Float32Array (or Float64Array)
const w = canvas.widthPx;

for (let y = 0; y < canvas.heightPx; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i]     = r;  // R
    data[i + 1] = g;  // G
    data[i + 2] = b;  // B
    data[i + 3] = 1;  // A
  }
}
```

For hot loops where bounds are validated at the region level, use the unchecked methods:

```typescript
// Per-pixel unchecked — skips bounds validation
canvas.buffer.setPixelUnchecked(x, y, r, g, b, a);
canvas.buffer.blendPixelUnchecked(x, y, r, g, b, a, 'add');

// Row-level bulk write — fastest for Canvas2DBridge-style patterns
const rowData = new Float32Array(width * 4);
// ... fill rowData ...
canvas.buffer.setRowUnchecked(y, startX, pixelCount, rowData);
canvas.buffer.blendRowUnchecked(y, startX, pixelCount, rowData, 'normal');
```

**Performance hierarchy** (fastest → slowest):
1. Direct `buffer.data` access — zero overhead
2. `setRowUnchecked` / `blendRowUnchecked` — one call per row
3. `setPixelUnchecked` / `blendPixelUnchecked` — one call per pixel, no bounds check
4. `setPixel` / `blendPixel` — one call per pixel with bounds validation

> **Tip:** Float32 (the default) is recommended for most use cases. It provides 7 significant digits of precision — more than enough for HDR color — at half the memory of Float64. For A3 @ 300 DPI, that's 67 MB vs 134 MB.

## Paper Size Reference

| Size | Dimensions (mm) | Pixels @ 300 DPI | Memory (Float32) |
|------|-----------------|-------------------|-------------------|
| A6 | 105 × 148 | 1240 × 1748 | 8.3 MB |
| A5 | 148 × 210 | 1748 × 2480 | 16.6 MB |
| A4 | 210 × 297 | 2480 × 3508 | 33.3 MB |
| A3 | 297 × 420 | 3508 × 4961 | 66.6 MB |
| A2 | 420 × 594 | 4961 × 7016 | 133 MB |
| A1 | 594 × 841 | 7016 × 9933 | 267 MB |
| A0 | 841 × 1189 | 9933 × 14043 | 534 MB |
| Letter | 215.9 × 279.4 | 2550 × 3300 | 32.2 MB |
| Legal | 215.9 × 355.6 | 2550 × 4200 | 41.0 MB |
| Tabloid | 279.4 × 431.8 | 3300 × 5100 | 64.5 MB |

> Memory shown is for the pixel buffer only (4 × Float32 per pixel). Float64 doubles these values.

## Architecture

```
hd-canvas/
  src/
    core/
      ColorBuffer.ts    — Float32/Float64 RGBA pixel buffer
      PaperSize.ts      — Paper size registry + DPI calculations
      HDCanvas.ts       — Main class, wires everything together
    preview/
      PreviewRenderer.ts — Zoom/pan interactive preview + overlay canvas management
      FitStrategy.ts     — Contain/cover fitting math
    bridge/
      Canvas2DBridge.ts  — Canvas 2D API → float buffer bridge
    export/
      ToneMapper.ts      — HDR → LDR tone mapping algorithms
      PNGExporter.ts     — PNG encoding with DPI metadata
      ExportPipeline.ts  — Glue: tone map → encode → Blob
    index.ts             — Unified public API
```

**Design principles:**
- **Dependency injection** — preview and export are pluggable, core has no DOM dependency
- **Interface segregation** — export pipeline codes against `IColorBuffer`, not the full `ColorBuffer`
- **Fail hard** — out-of-bounds pixels, invalid dimensions, and bad options throw immediately
- **One code path** — no duplicated logic, no silent fallbacks

## License

MIT
