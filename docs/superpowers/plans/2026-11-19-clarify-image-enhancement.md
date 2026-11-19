# KILOWASH CLARIFY (Image Enhancement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `CLARIFY` 4th detergent pod to KILOWASH for 100% client-side image enhancement (`STEAM` DSP + mobile-safe tiled `Xenova/swin2SR-lightweight-x2-64` 2× AI Super-Resolution), composable with `WASH` (BG AI) and `SPIN` (Target-MB), plus a Scene 2 Before/After Compare Slider.

**Architecture:** Extend the existing `mediaWorker.ts` worker protocol with a `CLARIFY` job so both tiled Swin2SR inference (WebGPU `fp16` → WASM `q8`) and the zero-dependency `STEAM` DSP filter run off the main thread. Wire `CLARIFY → WASH → SPIN` sequencing inside `mediaPipeline.ts`, add diegetic controls in `WallDispenserRackFixture` and `LaundryMachine`, and render an interactive split-compare overlay in `DryingLineScene`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Framer Motion, `@huggingface/transformers` v3.1.2 (`AutoModelForImageToImage` + `Swin2SR`), `OffscreenCanvas`, Playwright.

**Spec Reference:** [2026-11-19-clarify-image-enhancement-design.md](../specs/2026-11-19-clarify-image-enhancement-design.md)

---

### Task 1: Core Types, Worker Protocol & Theme Tokens

**Files:**
- Modify: `src/types/laundry.ts:1-63`
- Modify: `src/types/workerMessages.ts:1-56`
- Modify: `src/index.css:15-55`
- Modify: `src/components/CreatorSpotlight.tsx:15-20`
- Modify: `src/utils/laundrySfx.ts:260-276`

- [ ] **Step 1: Update `src/types/laundry.ts` with Clarify types and receipt metadata**

Replace lines 1–63 in `src/types/laundry.ts`:

```ts
export type ThemeShift = 'day' | 'night';

export type LaundryCycle = 'wash' | 'spin' | 'both' | 'clarify';

export type ClarifyEngineMode = 'auto' | 'steam' | 'ai';

export type ClarifyAppliedBackend = 'ai-webgpu' | 'ai-wasm' | 'steam-dsp';

export interface ClarifyOptions {
  mode: ClarifyEngineMode;
  withWash: boolean;
  withSpin: boolean;
}

export type MediaKind = 'image' | 'video';

export type ImageOutputFormat = 'webp' | 'png' | 'jpeg';

export type VideoOutputFormat = 'gif' | 'webm' | 'greenscreen';

export type RoomScene = 'washer' | 'drying';

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoTrim {
  start: number;
  end: number;
  fps: 10 | 12 | 15;
}

export interface WashProgress {
  phase:
    | 'idle'
    | 'loading-model'
    | 'filling'
    | 'extracting'
    | 'clarifying'
    | 'washing'
    | 'rinsing'
    | 'spinning'
    | 'encoding'
    | 'done'
    | 'error';
  percent: number;
  statusText: string;
  currentFrame?: number;
  totalFrames?: number;
  previewDataUrl?: string;
  currentSizeMB?: number;
}

export interface LaundryReceipt {
  fileName: string;
  mediaKind: MediaKind;
  cycle: LaundryCycle;
  hasTransparency: boolean;
  enforcedTargetMB: boolean;
  clarifyBackend?: ClarifyAppliedBackend;
  beforeUrl?: string;
  originalSizeMB: number;
  finalSizeMB: number;
  targetMB: number;
  savedPercent: number;
  width: number;
  height: number;
  formatLabel: string;
  fileExtension: string;
  durationMs: number;
  frameCount: number;
  outputUrl: string;
  outputBlob: Blob;
}
```

- [ ] **Step 2: Extend `src/types/workerMessages.ts` for `CLARIFY` jobs**

Replace `src/types/workerMessages.ts` contents with:

```ts
import type { ClarifyAppliedBackend, ClarifyEngineMode } from './laundry';

/**
 * Message protocol between the main UI thread and src/workers/mediaWorker.ts.
 * Heavy compute (RMBG-1.4, Swin2SR 2x, Steam DSP, Sobel fallback, GIF/PNG quantization)
 * lives in the worker so the drum rotation, 3D operator and Web Audio loops stay at 60 FPS.
 */

export type SegmentationBackend = 'webgpu' | 'wasm' | 'offline';

export interface SegmentJob {
  type: 'SEGMENT';
  id: number;
  /** Transferred zero-copy; the worker owns and closes it. */
  bitmap: ImageBitmap;
  /** Previous frame's smoothed mask for temporal alpha smoothing (transferred). */
  prevMask: Float32Array | null;
}

export interface ClarifyJob {
  type: 'CLARIFY';
  id: number;
  /** Transferred zero-copy; the worker owns and closes it. */
  bitmap: ImageBitmap;
  mode: ClarifyEngineMode;
  preferMobileSafe: boolean;
}

export interface GifJob {
  type: 'ENCODE_GIF';
  id: number;
  /** Transferred zero-copy; the worker owns and closes every frame. */
  frames: ImageBitmap[];
  fps: number;
  colorSteps: number[];
  scaleSteps: number[];
  /** null = encode a single best-effort attempt without a byte budget. */
  targetBytes: number | null;
}

export interface PngJob {
  type: 'ENCODE_PNG';
  id: number;
  /** Transferred zero-copy; the worker owns and closes it. */
  bitmap: ImageBitmap;
  targetBytes: number;
  scales: number[];
  colorBudgets: number[];
}

export type WorkerRequest = SegmentJob | ClarifyJob | GifJob | PngJob;

export type WorkerResponse =
  | { type: 'MODEL_PROGRESS'; id: number; percent: number; label: string }
  | { type: 'CLARIFY_PROGRESS'; id: number; percent: number; label: string }
  | { type: 'GIF_PROGRESS'; id: number; step: number; total: number; label: string }
  | { type: 'PNG_PROGRESS'; id: number; step: number; total: number }
  | {
      type: 'SEGMENT_DONE';
      id: number;
      bitmap: ImageBitmap;
      mask: Float32Array;
      usedFallback: boolean;
      backend: SegmentationBackend;
    }
  | {
      type: 'CLARIFY_DONE';
      id: number;
      bitmap: ImageBitmap;
      backend: ClarifyAppliedBackend;
      scaleFactor: number;
    }
  | { type: 'GIF_DONE'; id: number; blob: Blob; width: number; height: number }
  | { type: 'PNG_DONE'; id: number; blob: Blob; width: number; height: number }
  | { type: 'JOB_ERROR'; id: number; message: string };
```

- [ ] **Step 3: Add `--clarify-accent`, 3D operator color, and SFX phase mapping**

In `src/index.css`, add `--clarify-accent: #22C55E;` right after `--both-accent: #FFE600;` in both `:root` and `[data-shift='night']`.

In `src/components/CreatorSpotlight.tsx`, update `CYCLE_HEX`:
```ts
const CYCLE_HEX: Record<LaundryCycle, number> = {
  wash: 0x00e5ff,
  spin: 0xff5416,
  both: 0xffe600,
  clarify: 0x22c55e,
};
```

In `src/utils/laundrySfx.ts`, update `mapPhaseToLoopMode`:
```ts
function mapPhaseToLoopMode(phase: WashProgress['phase']): LoopMode | null {
  switch (phase) {
    case 'filling':
      return 'fill';
    case 'loading-model':
    case 'extracting':
    case 'clarifying':
    case 'washing':
      return 'wash';
    case 'rinsing':
      return 'rinse';
    case 'spinning':
    case 'encoding':
      return 'spin';
    default:
      return null;
  }
}
```

- [ ] **Step 4: Commit Task 1**

```bash
git add src/types/laundry.ts src/types/workerMessages.ts src/index.css src/components/CreatorSpotlight.tsx src/utils/laundrySfx.ts
git commit -m "feat(clarify): add cycle types, worker protocol, accent token, and sfx mapping"
```

---

### Task 2: Worker Enhancement Engine (`STEAM` DSP + Tiled `Swin2SR` 2×)

**Files:**
- Modify: `src/workers/mediaWorker.ts:1-20` and add Clarify helpers + `case 'CLARIFY':` handler in `onmessage`
- Modify: `src/services/mediaWorkerClient.ts:10-227`
- Create: `src/services/imageClarifier.ts`

- [ ] **Step 1: Add `CLARIFY` model loader, `STEAM` DSP filter, and tiled Swin2SR inference to `src/workers/mediaWorker.ts`**

1. Update imports & constants at top of `src/workers/mediaWorker.ts`:
```ts
import {
  AutoModel,
  AutoModelForImageToImage,
  AutoProcessor,
  RawImage,
  env,
} from '@huggingface/transformers';
import type { PreTrainedModel, Processor } from '@huggingface/transformers';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { ClarifyAppliedBackend } from '../types/laundry';
import type {
  ClarifyJob,
  GifJob,
  PngJob,
  SegmentJob,
  SegmentationBackend,
  WorkerRequest,
  WorkerResponse,
} from '../types/workerMessages';
```
And add:
```ts
const CLARIFY_MODEL_ID = 'Xenova/swin2SR-lightweight-x2-64';
const CLARIFY_TILE_SIZE = 128;
const CLARIFY_TILE_OVERLAP = 16;
const CLARIFY_TILE_STRIDE = CLARIFY_TILE_SIZE - CLARIFY_TILE_OVERLAP * 2; // 96px

interface LoadedClarifyModel {
  model: PreTrainedModel;
  processor: Processor;
  backend: 'webgpu' | 'wasm';
}

let loadedClarifyModel: LoadedClarifyModel | null = null;
let clarifyLoadPromise: Promise<LoadedClarifyModel> | null = null;
```

2. Add the Clarify engine functions in `src/workers/mediaWorker.ts` before `workerScope.onmessage`:

```ts
function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Fast 0-MB client-side enhancement:
 * 1) 3x3 edge-preserving luminance bilateral smooth (reduces JPEG blockiness)
 * 2) Unsharp mask sharpening
 * 3) Gentle S-curve micro-contrast & chroma lift
 */
function runSteamDspEnhance(source: ImageBitmap): ImageBitmap {
  const width = source.width;
  const height = source.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable.');

  ctx.drawImage(source, 0, 0);
  const imgData = ctx.getImageData(0, 0, width, height);
  const src = imgData.data;
  const pixelCount = width * height;

  const smoothR = new Float32Array(pixelCount);
  const smoothG = new Float32Array(pixelCount);
  const smoothB = new Float32Array(pixelCount);

  // Pass 1: Edge-preserving 3x3 bilateral denoise
  const sigmaRange = 28;
  const invTwoSigmaSq = 1 / (2 * sigmaRange * sigmaRange);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const p = idx * 4;
      const cr = src[p];
      const cg = src[p + 1];
      const cb = src[p + 2];
      const cLuma = 0.299 * cr + 0.587 * cg + 0.114 * cb;

      let sumW = 0;
      let accR = 0;
      let accG = 0;
      let accB = 0;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = Math.max(0, Math.min(height - 1, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.max(0, Math.min(width - 1, x + dx));
          const np = (ny * width + nx) * 4;
          const nr = src[np];
          const ng = src[np + 1];
          const nb = src[np + 2];
          const nLuma = 0.299 * nr + 0.587 * ng + 0.114 * nb;
          const diff = nLuma - cLuma;
          const spatial = dx === 0 && dy === 0 ? 1.0 : dx === 0 || dy === 0 ? 0.72 : 0.52;
          const w = spatial * Math.exp(-(diff * diff) * invTwoSigmaSq);
          sumW += w;
          accR += nr * w;
          accG += ng * w;
          accB += nb * w;
        }
      }

      smoothR[idx] = accR / sumW;
      smoothG[idx] = accG / sumW;
      smoothB[idx] = accB / sumW;
    }
  }

  // Pass 2: Unsharp mask + subtle micro-contrast & vibrance
  const out = new Uint8ClampedArray(src.length);
  const sharpAmount = 0.58;
  const threshold = 4;
  const contrast = 1.06;
  const satBoost = 1.05;

  for (let y = 0; y < height; y++) {
    const ym1 = Math.max(0, y - 1);
    const yp1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xm1 = Math.max(0, x - 1);
      const xp1 = Math.min(width - 1, x + 1);
      const idx = y * width + x;

      // 3x3 Gaussian blur of denoised signal for unsharp mask
      const blurR =
        (smoothR[ym1 * width + xm1] +
          2 * smoothR[ym1 * width + x] +
          smoothR[ym1 * width + xp1] +
          2 * smoothR[y * width + xm1] +
          4 * smoothR[idx] +
          2 * smoothR[y * width + xp1] +
          smoothR[yp1 * width + xm1] +
          2 * smoothR[yp1 * width + x] +
          smoothR[yp1 * width + xp1]) /
        16;

      const blurG =
        (smoothG[ym1 * width + xm1] +
          2 * smoothG[ym1 * width + x] +
          smoothG[ym1 * width + xp1] +
          2 * smoothG[y * width + xm1] +
          4 * smoothG[idx] +
          2 * smoothG[y * width + xp1] +
          smoothG[yp1 * width + xm1] +
          2 * smoothG[yp1 * width + x] +
          smoothG[yp1 * width + xp1]) /
        16;

      const blurB =
        (smoothB[ym1 * width + xm1] +
          2 * smoothB[ym1 * width + x] +
          smoothB[ym1 * width + xp1] +
          2 * smoothB[y * width + xm1] +
          4 * smoothB[idx] +
          2 * smoothB[y * width + xp1] +
          smoothB[yp1 * width + xm1] +
          2 * smoothB[yp1 * width + x] +
          smoothB[yp1 * width + xp1]) /
        16;

      const dr = smoothR[idx] - blurR;
      const dg = smoothG[idx] - blurG;
      const db = smoothB[idx] - blurB;

      let r = Math.abs(dr) > threshold ? smoothR[idx] + dr * sharpAmount : smoothR[idx];
      let g = Math.abs(dg) > threshold ? smoothG[idx] + dg * sharpAmount : smoothG[idx];
      let b = Math.abs(db) > threshold ? smoothB[idx] + db * sharpAmount : smoothB[idx];

      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;

      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      r = luma + (r - luma) * satBoost;
      g = luma + (g - luma) * satBoost;
      b = luma + (b - luma) * satBoost;

      const p = idx * 4;
      out[p] = clampByte(r);
      out[p + 1] = clampByte(g);
      out[p + 2] = clampByte(b);
      out[p + 3] = src[p + 3];
    }
  }

  ctx.putImageData(new ImageData(out, width, height), 0, 0);
  return canvas.transferToImageBitmap();
}

async function loadClarifyBackend(
  backend: 'webgpu' | 'wasm',
  jobId: number
): Promise<LoadedClarifyModel> {
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const progressMap = new Map<string, number>();
  const handleProgress = (info: { file?: string; progress?: number }) => {
    if (typeof info.progress !== 'number') return;
    progressMap.set(info.file ?? 'swin2sr', info.progress);
    let sum = 0;
    progressMap.forEach((v) => {
      sum += v;
    });
    const avg = Math.min(100, Math.round(sum / Math.max(1, progressMap.size)));
    const backendLabel = backend === 'webgpu' ? 'WEBGPU FP16' : 'WASM Q8';
    post({
      type: 'CLARIFY_PROGRESS',
      id: jobId,
      percent: Math.min(40, Math.round(avg * 0.4)),
      label: `LOADING SWIN2SR 2X ${backendLabel} (${avg}%)`,
    });
  };

  const dtype = backend === 'webgpu' ? 'fp16' : 'q8';

  const [model, processor] = await Promise.all([
    AutoModelForImageToImage.from_pretrained(CLARIFY_MODEL_ID, {
      dtype,
      device: backend,
      progress_callback: handleProgress,
    }),
    AutoProcessor.from_pretrained(CLARIFY_MODEL_ID, {
      progress_callback: handleProgress,
    }),
  ]);

  return { model, processor, backend };
}

async function ensureClarifyModelLoaded(jobId: number): Promise<LoadedClarifyModel> {
  if (offlineOnly) {
    throw new Error('Offline mode active.');
  }
  if (loadedClarifyModel) return loadedClarifyModel;
  if (clarifyLoadPromise) return clarifyLoadPromise;

  clarifyLoadPromise = (async () => {
    if (!webgpuRejected && (await hasWebGpuAdapter())) {
      try {
        loadedClarifyModel = await loadClarifyBackend('webgpu', jobId);
        return loadedClarifyModel;
      } catch (err) {
        webgpuRejected = true;
        console.warn('[KILOWASH CLARIFY] WebGPU unavailable, falling back to WASM:', err);
        post({
          type: 'CLARIFY_PROGRESS',
          id: jobId,
          percent: 5,
          label: 'WEBGPU UNAVAILABLE // LOADING WASM Q8...',
        });
      }
    }
    loadedClarifyModel = await loadClarifyBackend('wasm', jobId);
    return loadedClarifyModel;
  })();

  try {
    return await clarifyLoadPromise;
  } catch (err) {
    clarifyLoadPromise = null;
    throw err;
  }
}

function buildTileStarts(total: number): number[] {
  if (total <= CLARIFY_TILE_SIZE) return [0];
  const starts: number[] = [];
  for (let pos = 0; pos < total; pos += CLARIFY_TILE_STRIDE) {
    const start = Math.min(pos, total - CLARIFY_TILE_SIZE);
    if (!starts.includes(start)) {
      starts.push(start);
    }
    if (start + CLARIFY_TILE_SIZE >= total) break;
  }
  return starts;
}

function tileFeatherWeight(pos: number, length: number, hasLeading: boolean, hasTrailing: boolean): number {
  const feather = CLARIFY_TILE_OVERLAP * 2; // in 2x upscaled coords
  if (hasLeading && pos < feather) {
    return 0.5 - 0.5 * Math.cos((Math.PI * (pos + 0.5)) / feather);
  }
  if (hasTrailing && pos >= length - feather) {
    const dist = length - 1 - pos;
    return 0.5 - 0.5 * Math.cos((Math.PI * (dist + 0.5)) / feather);
  }
  return 1;
}

async function runTiledSwin2SR(
  source: ImageBitmap,
  preferMobileSafe: boolean,
  jobId: number
): Promise<{ bitmap: ImageBitmap; backend: ClarifyAppliedBackend; scaleFactor: number }> {
  const loaded = await ensureClarifyModelLoaded(jobId);

  // Clamp very large inputs before 2x upscaling so mobile/desktop VRAM stays bounded.
  const maxInputDim = preferMobileSafe ? 768 : 1280;
  const longest = Math.max(source.width, source.height);
  const preScale = longest > maxInputDim ? maxInputDim / longest : 1;
  const inW = Math.max(16, Math.round(source.width * preScale));
  const inH = Math.max(16, Math.round(source.height * preScale));

  const workCanvas = new OffscreenCanvas(inW, inH);
  const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!workCtx) throw new Error('OffscreenCanvas 2D context unavailable.');
  workCtx.imageSmoothingEnabled = true;
  workCtx.imageSmoothingQuality = 'high';
  workCtx.drawImage(source, 0, 0, inW, inH);

  const scale = 2;
  const outW = inW * scale;
  const outH = inH * scale;
  const accumR = new Float32Array(outW * outH);
  const accumG = new Float32Array(outW * outH);
  const accumB = new Float32Array(outW * outH);
  const accumW = new Float32Array(outW * outH);

  const xs = buildTileStarts(inW);
  const ys = buildTileStarts(inH);
  const totalTiles = xs.length * ys.length;
  let completedTiles = 0;

  for (const ty of ys) {
    const tileH = Math.min(CLARIFY_TILE_SIZE, inH - ty);
    for (const tx of xs) {
      const tileW = Math.min(CLARIFY_TILE_SIZE, inW - tx);

      const tileCanvas = new OffscreenCanvas(tileW, tileH);
      const tileCtx = tileCanvas.getContext('2d');
      if (!tileCtx) throw new Error('Tile canvas context unavailable.');
      tileCtx.drawImage(workCanvas, tx, ty, tileW, tileH, 0, 0, tileW, tileH);

      const rawTile = RawImage.fromCanvas(tileCanvas);
      const inputs = await loaded.processor(rawTile);
      const outputs = await loaded.model(inputs);
      const reconstruction = (outputs as { reconstruction: { [Symbol.iterator](): Iterator<unknown> } })
        .reconstruction;
      let batchTensor: {
        squeeze(): {
          clamp_(min: number, max: number): {
            mul_(v: number): { round_(): { to(dt: string): unknown } };
          };
        };
      } | null = null;
      for (const batch of reconstruction) {
        batchTensor = batch as typeof batchTensor;
        break;
      }
      if (!batchTensor) {
        throw new Error('Swin2SR returned an empty reconstruction tensor.');
      }
      const uintTensor = batchTensor.squeeze().clamp_(0, 1).mul_(255).round_().to('uint8');
      const upscaledTile = RawImage.fromTensor(uintTensor as never);

      const expectedW = tileW * scale;
      const expectedH = tileH * scale;
      const srcStride = upscaledTile.width;
      const ch = upscaledTile.channels;
      const data = upscaledTile.data;

      const hasLeft = tx > 0;
      const hasRight = tx + tileW < inW;
      const hasTop = ty > 0;
      const hasBottom = ty + tileH < inH;

      for (let py = 0; py < expectedH; py++) {
        const wy = tileFeatherWeight(py, expectedH, hasTop, hasBottom);
        const dstY = ty * scale + py;
        for (let px = 0; px < expectedW; px++) {
          const wx = tileFeatherWeight(px, expectedW, hasLeft, hasRight);
          const w = Math.max(1e-4, wx * wy);
          const sIdx = (py * srcStride + px) * ch;
          const dIdx = dstY * outW + (tx * scale + px);
          accumR[dIdx] += data[sIdx] * w;
          accumG[dIdx] += data[sIdx + 1] * w;
          accumB[dIdx] += data[sIdx + 2] * w;
          accumW[dIdx] += w;
        }
      }

      completedTiles += 1;
      const pct = 42 + Math.round((completedTiles / totalTiles) * 56);
      post({
        type: 'CLARIFY_PROGRESS',
        id: jobId,
        percent: Math.min(98, pct),
        label: `CLARIFY AI 2X // TILE ${completedTiles}/${totalTiles}`,
      });
    }
  }

  // Re-attach original alpha channel upscaled smoothly
  const alphaCanvas = new OffscreenCanvas(outW, outH);
  const alphaCtx = alphaCanvas.getContext('2d', { willReadFrequently: true });
  if (!alphaCtx) throw new Error('Alpha canvas context unavailable.');
  alphaCtx.imageSmoothingEnabled = true;
  alphaCtx.imageSmoothingQuality = 'high';
  alphaCtx.drawImage(source, 0, 0, outW, outH);
  const alphaBytes = alphaCtx.getImageData(0, 0, outW, outH).data;

  const outBytes = new Uint8ClampedArray(outW * outH * 4);
  for (let i = 0; i < outW * outH; i++) {
    const w = accumW[i] || 1;
    const p = i * 4;
    outBytes[p] = clampByte(accumR[i] / w);
    outBytes[p + 1] = clampByte(accumG[i] / w);
    outBytes[p + 2] = clampByte(accumB[i] / w);
    outBytes[p + 3] = alphaBytes[p + 3];
  }

  const outCanvas = new OffscreenCanvas(outW, outH);
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('Output canvas context unavailable.');
  outCtx.putImageData(new ImageData(outBytes, outW, outH), 0, 0);

  return {
    bitmap: outCanvas.transferToImageBitmap(),
    backend: loaded.backend === 'webgpu' ? 'ai-webgpu' : 'ai-wasm',
    scaleFactor: outW / source.width,
  };
}

async function runClarifyJob(job: ClarifyJob): Promise<void> {
  const { id, bitmap, mode, preferMobileSafe } = job;
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const hasGpu = await hasWebGpuAdapter();
    const autoAiCap = preferMobileSafe && !hasGpu ? 512 : hasGpu ? 1024 : 640;
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;

    const shouldTryAi =
      mode === 'ai' || (mode === 'auto' && isOnline && !offlineOnly && longest <= autoAiCap);

    if (shouldTryAi) {
      try {
        const result = await runTiledSwin2SR(bitmap, preferMobileSafe, id);
        post(
          {
            type: 'CLARIFY_DONE',
            id,
            bitmap: result.bitmap,
            backend: result.backend,
            scaleFactor: result.scaleFactor,
          },
          [result.bitmap]
        );
        return;
      } catch (err) {
        console.warn('[KILOWASH CLARIFY] AI path unavailable, falling back to Steam DSP:', err);
        post({
          type: 'CLARIFY_PROGRESS',
          id,
          percent: 65,
          label: 'AI UNAVAILABLE // RUNNING STEAM DSP...',
        });
      }
    } else {
      post({
        type: 'CLARIFY_PROGRESS',
        id,
        percent: 55,
        label: 'STEAM DSP // DENOISE & CRISP POLISH...',
      });
    }

    const steamBitmap = runSteamDspEnhance(bitmap);
    post(
      {
        type: 'CLARIFY_DONE',
        id,
        bitmap: steamBitmap,
        backend: 'steam-dsp',
        scaleFactor: 1,
      },
      [steamBitmap]
    );
  } finally {
    bitmap.close();
  }
}
```

3. In `workerScope.onmessage` inside `src/workers/mediaWorker.ts`, add `case 'CLARIFY':`:
```ts
      case 'CLARIFY':
        await runClarifyJob(msg);
        return;
```

- [ ] **Step 2: Wire `clarifyInWorker` in `src/services/mediaWorkerClient.ts`**

1. Update imports & interfaces in `src/services/mediaWorkerClient.ts`:
```ts
import type { ClarifyAppliedBackend, ClarifyEngineMode } from '../types/laundry';
import type { WorkerRequest, WorkerResponse } from '../types/workerMessages';
```
Add to `JobHandlers`:
```ts
  onClarifyProgress?: (percent: number, label: string) => void;
```
Add result type:
```ts
export interface ClarifyWorkerResult {
  bitmap: ImageBitmap;
  backend: ClarifyAppliedBackend;
  scaleFactor: number;
}
```
2. Update `handleMessage` switch in `src/services/mediaWorkerClient.ts`:
```ts
    case 'CLARIFY_PROGRESS':
      job.handlers.onClarifyProgress?.(message.percent, message.label);
      job.silenceTimer = armSilenceTimer();
      return;
```
and add `case 'CLARIFY_DONE':` next to `SEGMENT_DONE` / `GIF_DONE` / `PNG_DONE`.
3. Export `clarifyInWorker`:
```ts
/**
 * Enhances an image on the worker thread using tiled Swin2SR 2x or Steam DSP.
 * The bitmap is transferred zero-copy, so callers must not reuse it afterwards.
 */
export async function clarifyInWorker(
  bitmap: ImageBitmap,
  mode: ClarifyEngineMode,
  preferMobileSafe: boolean,
  onClarifyProgress?: (percent: number, label: string) => void
): Promise<ClarifyWorkerResult> {
  const response = await request(
    {
      type: 'CLARIFY',
      id: nextJobId++,
      bitmap,
      mode,
      preferMobileSafe,
    },
    [bitmap],
    { onClarifyProgress }
  );

  if (response.type !== 'CLARIFY_DONE') {
    throw new Error(`Unexpected worker response for CLARIFY: ${response.type}`);
  }

  return {
    bitmap: response.bitmap,
    backend: response.backend,
    scaleFactor: response.scaleFactor,
  };
}
```

- [ ] **Step 3: Create `src/services/imageClarifier.ts`**

```ts
import type { ClarifyAppliedBackend, ClarifyEngineMode } from '../types/laundry';
import { clarifyInWorker } from './mediaWorkerClient';

function detectMobileSafeDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowMem = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
  const coarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const smallScreen = window.innerWidth <= 768;
  return lowMem || (coarsePointer && smallScreen);
}

/**
 * Enhances a cropped HTMLCanvasElement off the main thread via mediaWorker.
 */
export async function clarifyCanvas(
  sourceCanvas: HTMLCanvasElement,
  mode: ClarifyEngineMode,
  onProgress?: (percent: number, label?: string) => void
): Promise<{
  canvas: HTMLCanvasElement;
  backend: ClarifyAppliedBackend;
  scaleFactor: number;
}> {
  const bitmap = await createImageBitmap(sourceCanvas);
  const preferMobileSafe = detectMobileSafeDevice();
  const result = await clarifyInWorker(bitmap, mode, preferMobileSafe, onProgress);

  try {
    const outCanvas = document.createElement('canvas');
    outCanvas.width = result.bitmap.width;
    outCanvas.height = result.bitmap.height;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable.');
    ctx.drawImage(result.bitmap, 0, 0);

    return {
      canvas: outCanvas,
      backend: result.backend,
      scaleFactor: result.scaleFactor,
    };
  } finally {
    result.bitmap.close();
  }
}
```

- [ ] **Step 4: Run build to verify Task 2 types**

Run: `npm run build`
Expected: PASS (no TS errors in worker, worker client, or clarifier service).

- [ ] **Step 5: Commit Task 2**

```bash
git add src/workers/mediaWorker.ts src/services/mediaWorkerClient.ts src/services/imageClarifier.ts
git commit -m "feat(clarify): implement Steam DSP and tiled Swin2SR 2x worker engine"
```

---

### Task 3: Integrate `CLARIFY -> WASH -> SPIN` Sequencing into `mediaPipeline.ts`

**Files:**
- Modify: `src/services/mediaPipeline.ts:1-15`, `275-445`, and `655-760`

- [ ] **Step 1: Import `clarifyCanvas` and `ClarifyOptions` in `src/services/mediaPipeline.ts`**

Update imports at lines 1–12 of `src/services/mediaPipeline.ts`:
```ts
import type {
  ClarifyAppliedBackend,
  ClarifyOptions,
  CropBox,
  ImageOutputFormat,
  LaundryCycle,
  LaundryReceipt,
  VideoOutputFormat,
  VideoTrim,
  WashProgress,
} from '../types/laundry';
import { removeBackgroundFromCanvas } from './aiBackgroundRemover';
import { clarifyCanvas } from './imageClarifier';
import { encodeGifInWorker, encodePngInWorker } from './mediaWorkerClient';
```

- [ ] **Step 2: Update `processImageLaundry` to execute `CLARIFY -> WASH -> SPIN` and emit `beforeUrl`, `clarifyBackend`, `hasTransparency`, `enforcedTargetMB`**

Replace `processImageLaundry` in `src/services/mediaPipeline.ts` (lines 279–445) with:

```ts
export async function processImageLaundry(params: {
  file: File;
  objectUrl: string;
  cycle: LaundryCycle;
  clarify?: ClarifyOptions;
  crop: CropBox;
  targetMB: number;
  outputFormat: ImageOutputFormat;
  onProgress: (p: WashProgress) => void;
}): Promise<LaundryReceipt> {
  const { file, objectUrl, cycle, clarify, crop, targetMB, outputFormat, onProgress } = params;
  const startedAt = performance.now();

  const runClarify = cycle === 'clarify';
  const runWash = cycle === 'wash' || cycle === 'both' || (runClarify && Boolean(clarify?.withWash));
  const runSpin = cycle === 'spin' || cycle === 'both' || (runClarify && Boolean(clarify?.withSpin));

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to read image file.'));
    el.src = objectUrl;
  });

  let workingCanvas = cropSourceToCanvas(img, img.naturalWidth, img.naturalHeight, crop);
  const inputPreviewUrl = previewDataUrl(workingCanvas);

  let beforeUrl: string | undefined;
  if (runClarify) {
    const beforeBlob = await canvasToBlob(workingCanvas, 'image/png');
    beforeUrl = URL.createObjectURL(beforeBlob);
  }

  // Stage 1: Locking Door & Filling Water
  await runTheatricalStage({
    phase: 'filling',
    fromPct: 2,
    toPct: 18,
    durationMs: 900,
    statusText: '01 // LOCKING DOOR & FILLING WATER...',
    previewDataUrl: inputPreviewUrl,
    onProgress,
  });

  let clarifyBackend: ClarifyAppliedBackend | undefined;
  if (runClarify) {
    let modelLoading = false;
    const clarifyMode = clarify?.mode ?? 'auto';

    const clarifyPromise = clarifyCanvas(workingCanvas, clarifyMode, (pct, label) => {
      modelLoading = pct < 42;
      onProgress({
        phase: 'clarifying',
        percent: Math.min(48, 18 + Math.round(pct * 0.3)),
        statusText: label ?? 'CLARIFYING IMAGE FIBERS...',
        previewDataUrl: inputPreviewUrl,
      });
    }).then((res) => {
      modelLoading = false;
      return res;
    });

    const clarifyAnim = runTheatricalStage({
      phase: 'clarifying',
      fromPct: 18,
      toPct: 48,
      durationMs: 1300,
      statusText: '02 // STEAM PRESS & SUPER-RES CLARIFY...',
      previewDataUrl: inputPreviewUrl,
      onProgress,
      pauseWhen: () => modelLoading,
    });

    const [clarified] = await Promise.all([clarifyPromise, clarifyAnim]);
    workingCanvas = clarified.canvas;
    clarifyBackend = clarified.backend;
  }

  const afterClarifyPreviewUrl = previewDataUrl(workingCanvas);

  if (runWash) {
    let modelIsDownloading = false;
    const washStartPct = runClarify ? 48 : 22;
    const washEndPct = runClarify ? 72 : 58;

    const aiPromise = removeBackgroundFromCanvas(workingCanvas, (modelPct, label) => {
      modelIsDownloading = modelPct < 100;
      onProgress({
        phase: 'loading-model',
        percent: Math.min(washEndPct - 2, washStartPct + Math.round(modelPct * 0.22)),
        statusText: label ?? 'LOADING RMBG-1.4 AI...',
        previewDataUrl: afterClarifyPreviewUrl,
      });
    }).then((res) => {
      modelIsDownloading = false;
      return res;
    });

    const scrubAnimPromise = runTheatricalStage({
      phase: 'washing',
      fromPct: washStartPct,
      toPct: washEndPct,
      durationMs: 1650,
      statusText: '02 // DEEP SCRUB & AI STAIN REMOVAL...',
      previewDataUrl: afterClarifyPreviewUrl,
      onProgress,
      pauseWhen: () => modelIsDownloading,
    });

    const [washed] = await Promise.all([aiPromise, scrubAnimPromise]);
    workingCanvas = washed.canvas;
    const cutoutPreviewUrl = previewDataUrl(workingCanvas);

    await runTheatricalStage({
      phase: 'rinsing',
      fromPct: washEndPct,
      toPct: 78,
      durationMs: 950,
      statusText: washed.usedFallback
        ? '03 // RINSING DIRTY BG (OFFLINE FALLBACK)...'
        : '03 // RINSING & DRAINING DIRTY BG...',
      previewDataUrl: cutoutPreviewUrl,
      onProgress,
    });
  }

  const currentPreviewUrl = previewDataUrl(workingCanvas);
  let finalBlob: Blob;
  let finalWidth = workingCanvas.width;
  let finalHeight = workingCanvas.height;

  if (runSpin) {
    const spinStartPct = runWash ? 78 : runClarify ? 48 : 22;
    const compressPromise = compressCanvasToTargetMB(
      workingCanvas,
      outputFormat,
      targetMB,
      () => {
        /* progress handled smoothly by theatrical spin stage */
      }
    );

    const spinAnimPromise = runTheatricalStage({
      phase: 'spinning',
      fromPct: spinStartPct,
      toPct: 96,
      durationMs: runWash ? 1150 : 1850,
      statusText: `04 // HIGH-SPEED SPIN & MB PRESS (<= ${targetMB.toFixed(2)} MB)...`,
      previewDataUrl: currentPreviewUrl,
      onProgress,
    });

    const [compressed] = await Promise.all([compressPromise, spinAnimPromise]);
    finalBlob = compressed.blob;
    finalWidth = compressed.width;
    finalHeight = compressed.height;
  } else {
    const encodePromise = encodeCanvasDirect(workingCanvas, outputFormat);
    const drainSpinPromise = runTheatricalStage({
      phase: 'spinning',
      fromPct: runWash ? 78 : 50,
      toPct: 96,
      durationMs: 900,
      statusText: `04 // DRAIN SPIN & ENCODING ${outputFormat.toUpperCase()}...`,
      previewDataUrl: currentPreviewUrl,
      onProgress,
    });

    const [encoded] = await Promise.all([encodePromise, drainSpinPromise]);
    finalBlob = encoded.blob;
    finalWidth = encoded.width;
    finalHeight = encoded.height;
  }

  onProgress({
    phase: 'done',
    percent: 100,
    statusText: '05 // CYCLE COMPLETE — HANGING TO DRY',
    previewDataUrl: currentPreviewUrl,
    currentSizeMB: bytesToMB(finalBlob.size),
  });
  await sleep(320);

  const originalSizeMB = bytesToMB(file.size);
  const finalSizeMB = bytesToMB(finalBlob.size);
  const savedPercent =
    originalSizeMB > 0
      ? Math.round(((originalSizeMB - finalSizeMB) / originalSizeMB) * 100)
      : 0;

  const formatExtMap: Record<ImageOutputFormat, string> = {
    webp: 'webp',
    png: 'png',
    jpeg: 'jpg',
  };

  return {
    fileName: file.name,
    mediaKind: 'image',
    cycle,
    hasTransparency: runWash && outputFormat !== 'jpeg',
    enforcedTargetMB: runSpin,
    clarifyBackend,
    beforeUrl,
    originalSizeMB,
    finalSizeMB,
    targetMB,
    savedPercent,
    width: finalWidth,
    height: finalHeight,
    formatLabel: `${outputFormat.toUpperCase()}${runWash && outputFormat !== 'jpeg' ? ' (TRANSPARENT)' : ''}`,
    fileExtension: formatExtMap[outputFormat],
    durationMs: Math.round(performance.now() - startedAt),
    frameCount: 1,
    outputUrl: URL.createObjectURL(finalBlob),
    outputBlob: finalBlob,
  };
}
```

- [ ] **Step 3: Add `hasTransparency` and `enforcedTargetMB` to `processVideoLaundry` return object**

In `processVideoLaundry` (`src/services/mediaPipeline.ts` around lines 815–835), add:
```ts
    hasTransparency: cycle === 'wash' || cycle === 'both',
    enforcedTargetMB: enforceTarget,
```

- [ ] **Step 4: Commit Task 3**

```bash
git add src/services/mediaPipeline.ts
git commit -m "feat(clarify): wire Clarify -> Wash -> Spin pipeline and receipt metadata"
```

---

### Task 4: Diegetic UI Controls (`WallDispenserRackFixture`, `LaundryMachine`, `App.tsx`)

**Files:**
- Modify: `src/components/RoomFixtures.tsx:1-10`, `151-265`
- Modify: `src/components/LaundryMachine.tsx:16-90`, `159-230`
- Modify: `src/App.tsx:26-52`, `168-288`, `342-405`, `742-800`

- [ ] **Step 1: Update `WallDispenserRackFixture` in `src/components/RoomFixtures.tsx`**

1. Import `ClarifyOptions`, `ClarifyEngineMode` from `'../types/laundry'` and `Sparkles` from `'lucide-react'`.
2. Add `clarify: ClarifyOptions` and `onChangeClarify: (next: ClarifyOptions) => void` to `WallDispenserRackFixtureProps`.
3. Update `spinEnabled`:
```ts
  const spinEnabled =
    cycle === 'spin' || cycle === 'both' || (cycle === 'clarify' && clarify.withSpin);
  const isVideo = media?.kind === 'video';
```
4. Change Unit `01 // DETERGENT PODS` grid from `grid-cols-3` to `grid-cols-2`, add the 4th `CLARIFY` pod (`sub: isVideo ? 'IMG ONLY' : 'HD 2X'`, `color: 'var(--clarify-accent)'`, `disabled: isProcessing || isVideo`), and render the compact Clarify controls block right underneath when `cycle === 'clarify'`:
```tsx
        {cycle === 'clarify' && (
          <div
            className="mt-2.5 pt-2.5 border-t-2 border-dashed flex flex-col gap-2"
            style={{ borderColor: 'var(--ink)' }}
          >
            <div className="grid grid-cols-3 gap-1">
              {(['auto', 'steam', 'ai'] as ClarifyEngineMode[]).map((m) => {
                const selected = clarify.mode === m;
                const label = m === 'ai' ? 'AI 2X' : m.toUpperCase();
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={isProcessing}
                    onClick={() => {
                      playMechanicalClick(720);
                      onChangeClarify({ ...clarify, mode: m });
                    }}
                    className="neo-btn py-1 font-mono text-[10px] font-bold uppercase"
                    style={{
                      backgroundColor: selected ? 'var(--clarify-accent)' : 'var(--ui-subtle)',
                      color: selected ? '#111111' : 'var(--ui-text)',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  playMechanicalClick(680);
                  onChangeClarify({ ...clarify, withWash: !clarify.withWash });
                }}
                className="neo-btn py-1 px-1.5 font-mono text-[10px] font-bold uppercase"
                style={{
                  backgroundColor: clarify.withWash ? 'var(--wash-accent)' : 'var(--ui-subtle)',
                  color: clarify.withWash ? '#111111' : 'var(--ui-text)',
                }}
              >
                {clarify.withWash ? '[✓] + BG AI' : '[ ] + BG AI'}
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  playMechanicalClick(680);
                  onChangeClarify({ ...clarify, withSpin: !clarify.withSpin });
                }}
                className="neo-btn py-1 px-1.5 font-mono text-[10px] font-bold uppercase"
                style={{
                  backgroundColor: clarify.withSpin ? 'var(--spin-accent)' : 'var(--ui-subtle)',
                  color: clarify.withSpin ? '#111111' : 'var(--ui-text)',
                }}
              >
                {clarify.withSpin ? '[✓] + TARGET MB' : '[ ] + TARGET MB'}
              </button>
            </div>
          </div>
        )}
```

- [ ] **Step 2: Update `LaundryMachine.tsx` for 4 lamps, 4-stop dial, clarifying drum animation, and readout**

1. Add `clarify: ClarifyOptions` to `LaundryMachineProps`.
2. Update `isWashing` and `isFastCentrifuge`:
```ts
  const isWashing =
    progress.phase === 'washing' ||
    progress.phase === 'clarifying' ||
    progress.phase === 'loading-model' ||
    progress.phase === 'extracting';
  const isRinsing = progress.phase === 'rinsing';
  const isSpinPhase =
    isProcessing && (progress.phase === 'spinning' || progress.phase === 'encoding');
  const isFastCentrifuge =
    isSpinPhase && (cycle === 'spin' || cycle === 'both' || (cycle === 'clarify' && clarify.withSpin));
```
3. Update `dialAngles`:
```ts
  const dialAngles: Record<LaundryCycle, number> = {
    wash: -52,
    spin: -18,
    both: 18,
    clarify: 52,
  };
```
4. Update `idleReadout`:
```ts
  const idleReadout = !media
    ? `IDLE // LOAD MEDIA (${cycle.toUpperCase()})`
    : cycle === 'wash'
    ? `WASH // RMBG-1.4 AI (${activeFormat})`
    : cycle === 'clarify'
    ? `CLARIFY // ${clarify.mode === 'ai' ? 'AI 2X' : clarify.mode.toUpperCase()}${
        clarify.withWash ? '+BG' : ''
      }${clarify.withSpin ? ` <= ${targetMB.toFixed(2)}MB` : ` (${activeFormat})`}`
    : `TARGET: ${targetMB.toFixed(2)} MB | ${activeFormat}`;
```
5. Add `{ id: 'clarify' as const, color: 'var(--clarify-accent)' }` to the header status lamps array and update the rotary dial `title` to `"Click to rotate program: Wash / Spin / Both / Clarify"`.

- [ ] **Step 3: Wire `clarify` state & cleanup in `src/App.tsx`**

1. Update `CYCLE_ACCENT_MAP`:
```ts
const CYCLE_ACCENT_MAP: Record<LaundryCycle, string> = {
  wash: '#00E5FF',
  spin: '#FF5416',
  both: '#FFE600',
  clarify: '#22C55E',
};
```
2. Add state:
```ts
  const [clarify, setClarify] = useState<ClarifyOptions>({
    mode: 'auto',
    withWash: false,
    withSpin: false,
  });
```
3. Revoke `receipt?.beforeUrl` alongside `receipt?.outputUrl` in cleanup `useEffect`, `handleLoadFile`, and `handleStartCycle`.
4. In `handleLoadFile`: if `loaded.kind === 'video'` and `cycle === 'clarify'`, reset `setCycle('both')`.
5. In `handleCycleDialClick`:
```ts
  const handleCycleDialClick = () => {
    playRotaryDialTick();
    const order: LaundryCycle[] =
      media?.kind === 'video' ? ['wash', 'spin', 'both'] : ['wash', 'spin', 'both', 'clarify'];
    setCycle((cur) => {
      const idx = order.indexOf(cur);
      return order[(idx === -1 ? 0 : idx + 1) % order.length];
    });
  };
```
6. Pass `clarify` to `processImageLaundry`, `LaundryMachine`, and `WallDispenserRackFixture` (`onChangeClarify={setClarify}`).

- [ ] **Step 4: Run build to verify Task 4**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/components/RoomFixtures.tsx src/components/LaundryMachine.tsx src/App.tsx
git commit -m "feat(clarify): add Clarify pod, sub-toggles, and 4-stop washer dial"
```

---

### Task 5: Scene 2 Before/After Compare Slider & Care Tag (`DryingLineScene.tsx`)

**Files:**
- Modify: `src/components/DryingLineScene.tsx:30-130`, `263-315`, `362-412`

- [ ] **Step 1: Add Before / After Compare Slider state and accurate receipt flags**

In `src/components/DryingLineScene.tsx`:
1. Add `const [compareSplit, setCompareSplit] = useState(50);` and `const [draggingSplit, setDraggingSplit] = useState(false);`.
2. Update `useTouchUpBrush` options:
```ts
  const brush = useTouchUpBrush({
    editable: receipt.mediaKind === 'image' && !showBefore && receipt.hasTransparency,
    outputUrl: receipt.outputUrl,
    outputWidth: receipt.width,
    outputHeight: receipt.height,
    originalUrl: originalMedia?.kind === 'image' ? originalMedia.objectUrl : null,
    crop,
    format: touchUpFormat,
    enforceTargetMB: receipt.enforcedTargetMB,
    targetMB: receipt.targetMB,
    onCommit: onOutputEdited,
  });
```
3. Update `metTarget`:
```ts
  const metTarget =
    !receipt.enforcedTargetMB || receipt.finalSizeMB <= receipt.targetMB + 0.01;
```
4. Compute `canCompareSplit = Boolean(receipt.beforeUrl && receipt.clarifyBackend && !brush.armed && !showBefore && !renderAsVideo);`.
5. Inside the Hanging Canvas Sheet (`<div className="w-full max-w-[420px] h-[300px] ...">`), when `canCompareSplit` is true, render the split-compare view:
```tsx
                {brush.armed ? (
                  <TouchUpCanvas api={brush} />
                ) : renderAsVideo ? (
                  <video
                    key={activeUrl}
                    src={activeUrl}
                    controls
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="max-w-full max-h-full object-contain p-3"
                  />
                ) : canCompareSplit && receipt.beforeUrl ? (
                  <div
                    role="slider"
                    aria-label="Before and after clarify comparison"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(compareSplit)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft') setCompareSplit((s) => Math.max(0, s - 5));
                      if (e.key === 'ArrowRight') setCompareSplit((s) => Math.min(100, s + 5));
                    }}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDraggingSplit(true);
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = ((e.clientX - rect.left) / rect.width) * 100;
                      setCompareSplit(Math.max(0, Math.min(100, pct)));
                    }}
                    onPointerMove={(e) => {
                      if (!draggingSplit) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = ((e.clientX - rect.left) / rect.width) * 100;
                      setCompareSplit(Math.max(0, Math.min(100, pct)));
                    }}
                    onPointerUp={() => setDraggingSplit(false)}
                    onPointerCancel={() => setDraggingSplit(false)}
                    className="relative w-full h-full select-none cursor-ew-resize touch-none"
                  >
                    <img
                      src={receipt.outputUrl}
                      alt="After Clarify output"
                      draggable={false}
                      className="absolute inset-0 w-full h-full object-contain p-3 pointer-events-none"
                    />
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ clipPath: `inset(0 ${100 - compareSplit}% 0 0)` }}
                    >
                      <img
                        src={receipt.beforeUrl}
                        alt="Before Clarify input"
                        draggable={false}
                        className="w-full h-full object-contain p-3"
                      />
                    </div>
                    <div
                      className="absolute top-0 bottom-0 w-0.5 pointer-events-none z-20"
                      style={{
                        left: `${compareSplit}%`,
                        backgroundColor: '#22C55E',
                        boxShadow: '0 0 0 1px #111111',
                      }}
                    >
                      <span
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 px-1.5 py-0.5 font-mono text-[9px] font-bold"
                        style={{
                          backgroundColor: '#22C55E',
                          color: '#111111',
                          border: '2px solid #111111',
                        }}
                      >
                        ◀ ▶
                      </span>
                    </div>
                    <span
                      className="absolute bottom-2 left-2.5 z-20 px-1.5 py-0.5 font-mono text-[9px] font-bold"
                      style={{ backgroundColor: '#111111', color: '#FFE600', border: '1px solid #FFE600' }}
                    >
                      BEFORE
                    </span>
                    <span
                      className="absolute bottom-2 right-2.5 z-20 px-1.5 py-0.5 font-mono text-[9px] font-bold"
                      style={{ backgroundColor: '#111111', color: '#22C55E', border: '1px solid #22C55E' }}
                    >
                      CLARIFIED
                    </span>
                  </div>
                ) : (
                  <img
                    src={activeUrl}
                    alt="KILOWASH Drying Line Output"
                    className="max-w-full max-h-full object-contain p-3"
                  />
                )}
```
6. On the Care Tag Receipt (`<dl>`):
   - Update `TARGET MB` row:
     ```tsx
     {!receipt.enforcedTargetMB
       ? receipt.cycle === 'clarify'
         ? 'N/A (CLARIFY ONLY)'
         : 'N/A (WASH ONLY)'
       : `<= ${receipt.targetMB.toFixed(2)} MB`}
     ```
   - Add `ENHANCE` row when `receipt.clarifyBackend` is defined:
     ```tsx
     {receipt.clarifyBackend && (
       <div className="flex justify-between gap-2">
         <dt className="opacity-80">ENHANCE</dt>
         <dd className="font-bold">
           {receipt.clarifyBackend === 'ai-webgpu'
             ? 'AI 2X (WEBGPU)'
             : receipt.clarifyBackend === 'ai-wasm'
             ? 'AI 2X (WASM)'
             : 'STEAM DSP'}
         </dd>
       </div>
     )}
     ```
7. Only render `<TouchUpShelf api={brush} />` when `receipt.hasTransparency` is true (so non-transparent Clarify outputs do not show a broken cutout brush).

- [ ] **Step 2: Run build to verify Task 5**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit Task 5**

```bash
git add src/components/DryingLineScene.tsx
git commit -m "feat(clarify): add Before/After compare slider and Care Tag enhance metadata"
```

---

### Task 6: Playwright Smoke Tests & Visual Verification

**Files:**
- Modify: `tests/smoke.spec.ts` (append Clarify test)

- [ ] **Step 1: Add deterministic `CLARIFY` (`STEAM` + `+ TARGET MB`) smoke test to `tests/smoke.spec.ts`**

Append to `tests/smoke.spec.ts`:

```ts
test('clarifies a sample image with Steam DSP + Target MB and renders compare slider', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'MEME IMG' }).click();
  await expect(page.getByRole('button', { name: 'START', exact: true })).toBeEnabled({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: /CLARIFY/ }).click();
  await page.getByRole('button', { name: 'STEAM', exact: true }).click();
  await page.getByRole('button', { name: /\+ TARGET MB/ }).click();
  await page.getByRole('button', { name: '0.2MB' }).click();
  await page.getByRole('button', { name: '-', exact: true }).click();
  await expect(page.getByText(/TARGET MB|<= 0\.05MB/)).toBeVisible();

  await page.getByRole('button', { name: 'START', exact: true }).click();
  await expect(page.getByText('CARE TAG // RECEIPT')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('STEAM DSP')).toBeVisible();
  await expect(
    page.getByRole('slider', { name: 'Before and after clarify comparison' })
  ).toBeVisible();

  const finalSizeMB = await page.evaluate(() => {
    const text = document.body.innerText;
    return Number((text.match(/FINAL SIZE\n([\d.]+) MB/) ?? [])[1]);
  });
  expect(finalSizeMB).toBeGreaterThan(0);
  expect(finalSizeMB).toBeLessThanOrEqual(0.06);
});
```

- [ ] **Step 2: Run full verification**

Run:
1. `npm run build` (Expected: TypeScript + Vite build clean)
2. `npm run smoke` (Expected: all Playwright smoke tests pass)
3. Visual check in browser for both Day Shift and Night Shift across Scene 1 (`CLARIFY` pod active) and Scene 2 (`Compare Slider` + `Care Tag`).

- [ ] **Step 3: Commit Task 6**

```bash
git add tests/smoke.spec.ts
git commit -m "test(clarify): add Playwright smoke test for Clarify + Target MB and compare slider"
```
