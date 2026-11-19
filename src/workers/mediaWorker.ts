import {
  AutoModel,
  AutoProcessor,
  RawImage,
  env,
} from '@huggingface/transformers';
import type { PreTrainedModel, Processor } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';
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

interface LoadedModel {
  model: PreTrainedModel;
  processor: Processor;
  backend: SegmentationBackend;
}

interface LoadedClarifySession {
  session: ort.InferenceSession;
  backend: 'webgpu' | 'wasm';
}

const MODEL_ID = 'briaai/RMBG-1.4';
const CLARIFY_MODEL_URL =
  'https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx';
const CLARIFY_CACHE_NAME = 'kilowash-clarify-onnx-v1';
const CLARIFY_TILE_SIZE = 128;
const CLARIFY_TILE_OVERLAP = 12;
const CLARIFY_TILE_STRIDE = CLARIFY_TILE_SIZE - CLARIFY_TILE_OVERLAP * 2; // 104px

/**
 * Dedicated module worker. Runs every heavy pixel/AI job so the main thread never stalls:
 * RMBG-1.4 inference (WebGPU -> WASM q8 fallback), Real-ESRGAN x4v3 + Steam DSP, Sobel offline fallback, and gifenc quantization.
 */
const workerScope = self as unknown as {
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

let loadedModel: LoadedModel | null = null;
let modelLoadPromise: Promise<LoadedModel> | null = null;
let loadedClarifySession: LoadedClarifySession | null = null;
let clarifyLoadPromise: Promise<LoadedClarifySession> | null = null;
let webgpuRejected = false;
let offlineOnly = false;

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  workerScope.postMessage(message, transfer);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Unknown media worker failure.';
}

async function hasWebGpuAdapter(): Promise<boolean> {
  // WebGPU is not in lib.dom for this TS version; the worker navigator exposes it in supporting browsers.
  const gpuNavigator = navigator as unknown as {
    readonly gpu?: { requestAdapter(): Promise<unknown> };
  };
  const gpu = gpuNavigator.gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function loadBackend(
  backend: 'webgpu' | 'wasm',
  jobId: number
): Promise<LoadedModel> {
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const progressMap = new Map<string, number>();
  const handleProgress = (info: { status?: string; file?: string; progress?: number }) => {
    if (typeof info.progress !== 'number') return;
    progressMap.set(info.file ?? 'model', info.progress);
    let sum = 0;
    progressMap.forEach((v) => {
      sum += v;
    });
    const avg = Math.min(100, Math.round(sum / Math.max(1, progressMap.size)));
    const backendLabel = backend === 'webgpu' ? 'WEBGPU FP16' : 'WASM Q8';
    post({
      type: 'MODEL_PROGRESS',
      id: jobId,
      percent: avg,
      label: `LOADING RMBG-1.4 ${backendLabel} (${avg}%)`,
    });
  };

  const dtype = backend === 'webgpu' ? 'fp16' : 'q8';

  const [model, processor] = await Promise.all([
    AutoModel.from_pretrained(MODEL_ID, {
      config: { model_type: 'custom' } as never,
      dtype,
      device: backend,
      progress_callback: handleProgress,
    }),
    AutoProcessor.from_pretrained(MODEL_ID, {
      config: {
        do_normalize: true,
        do_pad: false,
        do_rescale: true,
        do_resize: true,
        image_mean: [0.5, 0.5, 0.5],
        feature_extractor_type: 'ImageFeatureExtractor',
        image_std: [1, 1, 1],
        resample: 2,
        rescale_factor: 0.00392156862745098,
        size: { width: 1024, height: 1024 },
      } as never,
      progress_callback: handleProgress,
    }),
  ]);

  return { model, processor, backend };
}

/**
 * Loads RMBG-1.4 once per worker: WebGPU (fp16) when an adapter exists, otherwise WASM (q8).
 * A failed WebGPU session is remembered so later frames go straight to WASM.
 */
async function ensureModelLoaded(jobId: number): Promise<LoadedModel> {
  if (offlineOnly) {
    throw new Error('Offline fallback segmentation active.');
  }
  if (loadedModel) return loadedModel;
  if (modelLoadPromise) return modelLoadPromise;

  modelLoadPromise = (async () => {
    if (!webgpuRejected && (await hasWebGpuAdapter())) {
      try {
        loadedModel = await loadBackend('webgpu', jobId);
        return loadedModel;
      } catch (err) {
        webgpuRejected = true;
        console.warn('[KILOWASH AI] WebGPU backend unavailable, using WASM:', err);
        post({
          type: 'MODEL_PROGRESS',
          id: jobId,
          percent: 0,
          label: 'WEBGPU UNAVAILABLE // LOADING WASM Q8...',
        });
      }
    }
    loadedModel = await loadBackend('wasm', jobId);
    return loadedModel;
  })();

  try {
    return await modelLoadPromise;
  } catch (err) {
    modelLoadPromise = null;
    throw err;
  }
}

/**
 * Runs RMBG-1.4 and returns a per-pixel alpha mask (0..1) resized to the source bitmap.
 */
async function predictAlphaMask(
  model: PreTrainedModel,
  processor: Processor,
  canvas: OffscreenCanvas,
  width: number,
  height: number
): Promise<Float32Array> {
  const rawImg = RawImage.fromCanvas(canvas);
  const { pixel_values } = await processor(rawImg);

  const session = model.sessions.model as
    | { inputNames?: string[]; outputNames?: string[] }
    | undefined;

  const inputName = session?.inputNames?.[0] ?? 'input';
  const outputs = await model({ [inputName]: pixel_values });
  const outKey = session?.outputNames?.[0] ?? Object.keys(outputs)[0];
  let tensor = outputs[outKey];
  while (tensor.dims.length > 2) {
    tensor = tensor[0];
  }

  const maskH = tensor.dims[0];
  const maskW = tensor.dims[1];
  const rawData = tensor.data as Float32Array;
  const len = rawData.length;

  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < len; i++) {
    if (rawData[i] < minVal) minVal = rawData[i];
    if (rawData[i] > maxVal) maxVal = rawData[i];
  }

  const normalized = new Float32Array(len);
  const needsSigmoid = minVal < -1e-3 || maxVal > 1 + 1e-3;
  if (needsSigmoid) {
    minVal = Infinity;
    maxVal = -Infinity;
    for (let i = 0; i < len; i++) {
      const s = 1 / (1 + Math.exp(-rawData[i]));
      normalized[i] = s;
      if (s < minVal) minVal = s;
      if (s > maxVal) maxVal = s;
    }
  } else {
    normalized.set(rawData);
  }

  const maskUint8 = new Uint8ClampedArray(len);
  const span = maxVal - minVal;
  const shouldNormalizeSpan = span > 0.25;
  for (let i = 0; i < len; i++) {
    const val = shouldNormalizeSpan
      ? (normalized[i] - minVal) / span
      : Math.max(0, Math.min(1, normalized[i]));
    maskUint8[i] = Math.round(Math.max(0, Math.min(1, val)) * 255);
  }

  const maskRaw = new RawImage(maskUint8, maskW, maskH, 1);
  const resizedMask = await maskRaw.resize(width, height);
  const maskBytes = resizedMask.data;
  const totalPixels = width * height;
  const alphaMask = new Float32Array(totalPixels);
  const channels = resizedMask.channels;

  for (let i = 0; i < totalPixels; i++) {
    alphaMask[i] = maskBytes[i * channels] / 255;
  }

  return alphaMask;
}

/**
 * Resilient border-sampled flood segmentation with Sobel edge-gradient barriers
 * when remote Hugging Face weights are unreachable (offline fallback).
 * Tight color tolerance keeps interior highlights/stripes of an object intact.
 */
function fallbackBorderSegmentation(imageData: ImageData): Float32Array {
  const { width, height, data } = imageData;
  const total = width * height;

  // Precompute grayscale luminance and Sobel edge magnitude
  const luma = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    luma[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  const grad = new Float32Array(total);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx =
        -luma[idx - width - 1] +
        luma[idx - width + 1] -
        2 * luma[idx - 1] +
        2 * luma[idx + 1] -
        luma[idx + width - 1] +
        luma[idx + width + 1];
      const gy =
        -luma[idx - width - 1] -
        2 * luma[idx - width] -
        luma[idx - width + 1] +
        luma[idx + width - 1] +
        2 * luma[idx + width] +
        luma[idx + width + 1];
      grad[idx] = Math.hypot(gx, gy);
    }
  }

  // Sample outer border pixels
  const borderSamples: Array<[number, number, number]> = [];
  const stepX = Math.max(1, Math.floor(width / 28));
  const stepY = Math.max(1, Math.floor(height / 28));

  for (let x = 0; x < width; x += stepX) {
    for (const y of [0, 2, height - 3, height - 1]) {
      if (y >= 0 && y < height) {
        const idx = (y * width + x) * 4;
        borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
      }
    }
  }
  for (let y = 0; y < height; y += stepY) {
    for (const x of [0, 2, width - 3, width - 1]) {
      if (x >= 0 && x < width) {
        const idx = (y * width + x) * 4;
        borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
      }
    }
  }

  const matchesBorderDist = (r: number, g: number, b: number): boolean => {
    for (let i = 0; i < borderSamples.length; i++) {
      const [br, bg, bb] = borderSamples[i];
      const dr = r - br;
      const dg = g - bg;
      const db = b - bb;
      if (dr * dr + dg * dg + db * db < 1400) {
        return true;
      }
    }
    return false;
  };

  const isBg = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const pushSeed = (x: number, y: number) => {
    const p = y * width + x;
    if (visited[p]) return;
    visited[p] = 1;
    isBg[p] = 1;
    queue[tail++] = p;
  };

  for (let x = 0; x < width; x++) {
    pushSeed(x, 0);
    pushSeed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    pushSeed(0, y);
    pushSeed(width - 1, y);
  }

  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % width;
    const cy = Math.floor(cur / width);
    const cIdx = cur * 4;
    const cr = data[cIdx];
    const cg = data[cIdx + 1];
    const cb = data[cIdx + 2];

    for (let d = 0; d < 4; d++) {
      const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const np = ny * width + nx;
      if (visited[np]) continue;
      if (grad[np] > 95) continue;

      const nIdx = np * 4;
      const nr = data[nIdx];
      const ng = data[nIdx + 1];
      const nb = data[nIdx + 2];

      const stepDist =
        (nr - cr) * (nr - cr) + (ng - cg) * (ng - cg) + (nb - cb) * (nb - cb);

      if (stepDist < 1200 && matchesBorderDist(nr, ng, nb)) {
        visited[np] = 1;
        isBg[np] = 1;
        queue[tail++] = np;
      }
    }
  }

  const alphaMask = new Float32Array(total);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (isBg[p]) {
        alphaMask[p] = 0;
      } else {
        let bgNeighbors = 0;
        if (x > 0 && isBg[p - 1]) bgNeighbors++;
        if (x < width - 1 && isBg[p + 1]) bgNeighbors++;
        if (y > 0 && isBg[p - width]) bgNeighbors++;
        if (y < height - 1 && isBg[p + width]) bgNeighbors++;
        alphaMask[p] = bgNeighbors > 0 ? Math.max(0.2, 1 - bgNeighbors * 0.22) : 1;
      }
    }
  }

  return alphaMask;
}

/**
 * Applies temporal alpha smoothing (0.82 current + 0.18 previous) and bakes the mask
 * into the canvas alpha channel, then hands the pixels back as a transferable bitmap.
 */
function compositeWithAlphaMask(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  alphaMask: Float32Array,
  prevAlphaMask: Float32Array | null
): { bitmap: ImageBitmap; alphaMask: Float32Array } {
  const totalPixels = width * height;
  const smoothed = new Float32Array(totalPixels);
  const canBlend = prevAlphaMask !== null && prevAlphaMask.length === totalPixels;

  for (let i = 0; i < totalPixels; i++) {
    let a = alphaMask[i];
    if (canBlend) {
      a = 0.82 * a + 0.18 * prevAlphaMask[i];
    }
    if (a < 0.06) a = 0;
    else if (a > 0.94) a = 1;
    smoothed[i] = a;
  }

  const imgData = ctx.getImageData(0, 0, width, height);
  const pixels = imgData.data;
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    pixels[idx + 3] = Math.round(smoothed[i] * pixels[idx + 3]);
  }
  ctx.putImageData(imgData, 0, 0);

  return { bitmap: ctx.canvas.transferToImageBitmap(), alphaMask: smoothed };
}

async function runSegmentation(job: SegmentJob): Promise<void> {
  const { id, bitmap, prevMask } = job;
  const width = bitmap.width;
  const height = bitmap.height;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2D context is unavailable.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  let alphaMask: Float32Array;
  let backend: SegmentationBackend;
  let usedFallback = false;

  try {
    const loaded = await ensureModelLoaded(id);
    backend = loaded.backend;
    alphaMask = await predictAlphaMask(loaded.model, loaded.processor, canvas, width, height);
  } catch (err) {
    console.warn('[KILOWASH AI] Falling back to offline segmentation:', err);
    offlineOnly = true;
    usedFallback = true;
    backend = 'offline';
    alphaMask = fallbackBorderSegmentation(ctx.getImageData(0, 0, width, height));
  }

  const composited = compositeWithAlphaMask(ctx, width, height, alphaMask, prevMask);

  post(
    {
      type: 'SEGMENT_DONE',
      id,
      bitmap: composited.bitmap,
      mask: composited.alphaMask,
      usedFallback,
      backend,
    },
    [composited.bitmap, composited.alphaMask.buffer as ArrayBuffer]
  );
}

/**
 * Encodes one GIF attempt: magenta-key transparency, palette quantization, optional downscale.
 */
function encodeGifAttempt(
  frames: ImageBitmap[],
  fps: number,
  maxColors: number,
  scale: number
): { blob: Blob; width: number; height: number } {
  const srcW = frames[0].width;
  const srcH = frames[0].height;
  const width = scale === 1 ? srcW : Math.max(24, Math.round((srcW * scale) / 2) * 2);
  const height = scale === 1 ? srcH : Math.max(24, Math.round((srcH * scale) / 2) * 2);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2D context is unavailable.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const delayMs = Math.round(1000 / fps);
  const pixelCount = width * height;
  const gif = GIFEncoder();

  for (let fi = 0; fi < frames.length; fi++) {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(frames[fi], 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const raw = imgData.data;
    const keyed = new Uint8Array(raw.length);
    const alphaFlags = new Uint8Array(pixelCount);

    let hasTransparency = false;
    for (let p = 0; p < pixelCount; p++) {
      const idx = p * 4;
      const alpha = raw[idx + 3];
      if (alpha < 128) {
        hasTransparency = true;
        alphaFlags[p] = 1;
        keyed[idx] = 255;
        keyed[idx + 1] = 0;
        keyed[idx + 2] = 255;
        keyed[idx + 3] = 255;
      } else {
        let r = raw[idx];
        let g = raw[idx + 1];
        let b = raw[idx + 2];
        // Prevent opaque bright magenta from colliding with transparent key [255, 0, 255]
        if (r > 248 && g < 8 && b > 248) {
          g = 12;
        }
        keyed[idx] = r;
        keyed[idx + 1] = g;
        keyed[idx + 2] = b;
        keyed[idx + 3] = 255;
      }
    }

    const quantBudget = hasTransparency ? Math.max(4, maxColors - 1) : maxColors;
    const palette = quantize(keyed, quantBudget, { format: 'rgb565' });

    let transparentIndex = 0;
    if (hasTransparency) {
      transparentIndex = palette.length;
      palette.push([255, 0, 255]);
    }

    const indices = applyPalette(keyed, palette, 'rgb565');
    if (hasTransparency) {
      for (let p = 0; p < pixelCount; p++) {
        if (alphaFlags[p] === 1) {
          indices[p] = transparentIndex;
        }
      }
    }

    gif.writeFrame(indices, width, height, {
      palette,
      delay: delayMs,
      repeat: 0,
      transparent: hasTransparency,
      transparentIndex,
      dispose: hasTransparency ? 2 : -1,
    });
  }

  gif.finish();
  const bytes = gif.bytesView();
  const safeBuffer = new Uint8Array(bytes.byteLength);
  safeBuffer.set(bytes);

  return {
    blob: new Blob([safeBuffer], { type: 'image/gif' }),
    width,
    height,
  };
}

/**
 * Posterizes RGBA pixels to a palette so the PNG's zlib stream gets more repeated runs.
 * (Canvas PNG output is always truecolor; quantization is a size trick, not indexed output.)
 */
function quantizePngPixels(source: ImageData, maxColors: number): ImageData {
  const imgData = new ImageData(
    new Uint8ClampedArray(source.data),
    source.width,
    source.height
  );
  const rgba = new Uint8Array(imgData.data.buffer.slice(0));

  const palette = quantize(rgba, maxColors, { format: 'rgba4444', oneBitAlpha: true });
  const indices = applyPalette(rgba, palette, 'rgba4444');
  const dst = imgData.data;

  for (let i = 0; i < indices.length; i++) {
    const color = palette[indices[i]];
    const p = i * 4;
    dst[p] = color[0];
    dst[p + 1] = color[1];
    dst[p + 2] = color[2];
    dst[p + 3] = color[3] ?? 255;
  }
  return imgData;
}

/**
 * Runs the PNG Target-MB solver off the main thread: one direct encode, then palette
 * quantization across decreasing color budgets for each downscale step.
 */
async function runPngEncoding(job: PngJob): Promise<void> {
  const { id, bitmap, targetBytes, scales, colorBudgets } = job;
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  const source = new OffscreenCanvas(srcW, srcH);
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) throw new Error('OffscreenCanvas 2D context is unavailable.');
  sourceCtx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const direct = await source.convertToBlob({ type: 'image/png' });
  const totalSteps = 1 + scales.length * colorBudgets.length;
  let step = 1;
  post({ type: 'PNG_PROGRESS', id, step, total: totalSteps });

  let best: { blob: Blob; width: number; height: number } = {
    blob: direct,
    width: srcW,
    height: srcH,
  };
  if (direct.size <= targetBytes) {
    post({ type: 'PNG_DONE', id, ...best });
    return;
  }

  for (const scale of scales) {
    const width = scale === 1 ? srcW : Math.max(24, Math.round((srcW * scale) / 2) * 2);
    const height = scale === 1 ? srcH : Math.max(24, Math.round((srcH * scale) / 2) * 2);

    let basePixels: ImageData;
    if (scale === 1) {
      basePixels = sourceCtx.getImageData(0, 0, width, height);
    } else {
      const scaled = new OffscreenCanvas(width, height);
      const scaledCtx = scaled.getContext('2d', { willReadFrequently: true });
      if (!scaledCtx) continue;
      scaledCtx.imageSmoothingEnabled = true;
      scaledCtx.imageSmoothingQuality = 'high';
      scaledCtx.drawImage(source, 0, 0, width, height);
      basePixels = scaledCtx.getImageData(0, 0, width, height);
    }

    const scratch = new OffscreenCanvas(width, height);
    const scratchCtx = scratch.getContext('2d');
    if (!scratchCtx) continue;

    for (const colors of colorBudgets) {
      step++;
      post({ type: 'PNG_PROGRESS', id, step, total: totalSteps });
      scratchCtx.putImageData(quantizePngPixels(basePixels, colors), 0, 0);
      const blob = await scratch.convertToBlob({ type: 'image/png' });
      if (blob.size < best.blob.size) {
        best = { blob, width, height };
      }
      if (blob.size <= targetBytes) {
        post({ type: 'PNG_DONE', id, ...best });
        return;
      }
    }
  }

  post({ type: 'PNG_DONE', id, ...best });
}

/**
 * Runs the Target-MB GIF solver entirely off the main thread (color + scale descent).
 */
async function runGifEncoding(job: GifJob): Promise<void> {
  const { id, frames, fps, colorSteps, scaleSteps, targetBytes } = job;

  if (frames.length === 0) {
    throw new Error('No frames supplied to the GIF encoder.');
  }

  const totalSteps = colorSteps.length * scaleSteps.length;
  let step = 0;
  let best: { blob: Blob; width: number; height: number } | null = null;

  try {
    attempts: for (const scale of scaleSteps) {
      for (const colors of colorSteps) {
        step++;
        post({
          type: 'GIF_PROGRESS',
          id,
          step,
          total: totalSteps,
          label: `${colors} COLORS @ ${Math.round(scale * 100)}%`,
        });

        const encoded = encodeGifAttempt(frames, fps, colors, scale);
        if (!best || encoded.blob.size < best.blob.size) {
          best = encoded;
        }
        if (targetBytes === null || encoded.blob.size <= targetBytes) {
          best = encoded;
          break attempts;
        }
      }
    }
  } finally {
    for (const frame of frames) {
      frame.close();
    }
  }

  if (!best) throw new Error('GIF encoding produced no output.');

  post({ type: 'GIF_DONE', id, blob: best.blob, width: best.width, height: best.height });
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Fast 0-MB client-side enhancement:
 * 1) 3x3 edge-preserving luminance bilateral smooth (reduces JPEG blockiness)
 * 2) Unsharp mask sharpening
 * 3) Subtle S-curve micro-contrast & chroma lift
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

  const sigmaRange = 16;
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

  const out = new Uint8ClampedArray(src.length);
  const sharpAmount = 1.05;
  const threshold = 2;
  const contrast = 1.09;
  const satBoost = 1.08;

  for (let y = 0; y < height; y++) {
    const ym1 = Math.max(0, y - 1);
    const yp1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xm1 = Math.max(0, x - 1);
      const xp1 = Math.min(width - 1, x + 1);
      const idx = y * width + x;

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

async function fetchClarifyModelBytes(jobId: number): Promise<Uint8Array> {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CLARIFY_CACHE_NAME);
      const cached = await cache.match(CLARIFY_MODEL_URL);
      if (cached && cached.ok) {
        post({
          type: 'CLARIFY_PROGRESS',
          id: jobId,
          percent: 32,
          label: 'REAL-ESRGAN X4 // LOADED FROM CACHE',
        });
        return new Uint8Array(await cached.arrayBuffer());
      }
    } catch {
      /* Cache API may be unavailable in restricted contexts */
    }
  }

  post({
    type: 'CLARIFY_PROGRESS',
    id: jobId,
    percent: 4,
    label: 'DOWNLOADING REAL-ESRGAN X4 (4.8 MB)...',
  });

  const response = await fetch(CLARIFY_MODEL_URL);
  if (!response.ok) {
    throw new Error(`Model fetch failed (${response.status})`);
  }

  const totalBytes = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body?.getReader();
  let bytes: Uint8Array;

  if (reader) {
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        if (totalBytes > 0) {
          const dlPct = Math.min(100, Math.round((received / totalBytes) * 100));
          post({
            type: 'CLARIFY_PROGRESS',
            id: jobId,
            percent: Math.min(35, Math.round(dlPct * 0.35)),
            label: `DOWNLOADING REAL-ESRGAN X4 (${dlPct}%)`,
          });
        }
      }
    }
    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
  }

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CLARIFY_CACHE_NAME);
      await cache.put(
        CLARIFY_MODEL_URL,
        new Response(bytes.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      );
    } catch {
      /* ignore cache write failure */
    }
  }

  return bytes;
}

async function loadClarifySession(
  backend: 'webgpu' | 'wasm',
  bytes: Uint8Array,
  jobId: number
): Promise<LoadedClarifySession> {
  if (!ort.env.wasm.wasmPaths && env.backends?.onnx?.wasm?.wasmPaths) {
    ort.env.wasm.wasmPaths = env.backends.onnx.wasm.wasmPaths as never;
  }

  const backendLabel = backend === 'webgpu' ? 'WEBGPU' : 'WASM';
  post({
    type: 'CLARIFY_PROGRESS',
    id: jobId,
    percent: 38,
    label: `INITIALIZING REAL-ESRGAN X4 (${backendLabel})...`,
  });

  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: [backend],
  });

  return { session, backend };
}

async function ensureClarifySessionLoaded(jobId: number): Promise<LoadedClarifySession> {
  if (offlineOnly) {
    throw new Error('Offline mode active.');
  }
  if (loadedClarifySession) return loadedClarifySession;
  if (clarifyLoadPromise) return clarifyLoadPromise;

  clarifyLoadPromise = (async () => {
    const modelBytes = await fetchClarifyModelBytes(jobId);

    if (!webgpuRejected && (await hasWebGpuAdapter())) {
      try {
        loadedClarifySession = await loadClarifySession('webgpu', modelBytes, jobId);
        return loadedClarifySession;
      } catch (err) {
        webgpuRejected = true;
        console.warn('[KILOWASH CLARIFY] WebGPU unavailable, falling back to WASM:', err);
      }
    }

    loadedClarifySession = await loadClarifySession('wasm', modelBytes, jobId);
    return loadedClarifySession;
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

function tileFeatherWeight(
  pos: number,
  length: number,
  hasLeading: boolean,
  hasTrailing: boolean
): number {
  const feather = CLARIFY_TILE_OVERLAP * 4;
  if (hasLeading && pos < feather) {
    return 0.5 - 0.5 * Math.cos((Math.PI * (pos + 0.5)) / feather);
  }
  if (hasTrailing && pos >= length - feather) {
    const dist = length - 1 - pos;
    return 0.5 - 0.5 * Math.cos((Math.PI * (dist + 0.5)) / feather);
  }
  return 1;
}

async function runTiledRealEsrgan(
  source: ImageBitmap,
  preferMobileSafe: boolean,
  jobId: number
): Promise<{ bitmap: ImageBitmap; backend: ClarifyAppliedBackend; scaleFactor: number }> {
  const loaded = await ensureClarifySessionLoaded(jobId);

  // Cap input dimensions before 4x upscaling so browser output stays bounded (<= 2048px mobile, 3072px desktop).
  const maxInputDim = preferMobileSafe ? 512 : 768;
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

  const scale = 4;
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

  const inputName = loaded.session.inputNames[0] ?? 'input';
  const outputName = loaded.session.outputNames[0] ?? 'output';

  for (const ty of ys) {
    const tileH = Math.min(CLARIFY_TILE_SIZE, inH - ty);
    for (const tx of xs) {
      const tileW = Math.min(CLARIFY_TILE_SIZE, inW - tx);

      const tileCanvas = new OffscreenCanvas(tileW, tileH);
      const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true });
      if (!tileCtx) throw new Error('Tile canvas context unavailable.');
      tileCtx.drawImage(workCanvas, tx, ty, tileW, tileH, 0, 0, tileW, tileH);

      const tilePixels = tileCtx.getImageData(0, 0, tileW, tileH).data;
      const hw = tileW * tileH;
      const nchw = new Float32Array(3 * hw);
      for (let i = 0; i < hw; i++) {
        const p = i * 4;
        nchw[i] = tilePixels[p] / 255;
        nchw[hw + i] = tilePixels[p + 1] / 255;
        nchw[hw * 2 + i] = tilePixels[p + 2] / 255;
      }

      const inputTensor = new ort.Tensor('float32', nchw, [1, 3, tileH, tileW]);
      const outputs = await loaded.session.run({ [inputName]: inputTensor });
      const outTensor = outputs[outputName] ?? Object.values(outputs)[0];
      if (!outTensor) {
        throw new Error('Real-ESRGAN returned an empty output tensor.');
      }

      const outData = outTensor.data as Float32Array;
      const expectedW = tileW * scale;
      const expectedH = tileH * scale;
      const outPlane = expectedW * expectedH;

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
          const sIdx = py * expectedW + px;
          const dIdx = dstY * outW + (tx * scale + px);
          accumR[dIdx] += Math.max(0, Math.min(1, outData[sIdx])) * 255 * w;
          accumG[dIdx] += Math.max(0, Math.min(1, outData[outPlane + sIdx])) * 255 * w;
          accumB[dIdx] += Math.max(0, Math.min(1, outData[outPlane * 2 + sIdx])) * 255 * w;
          accumW[dIdx] += w;
        }
      }

      try {
        (inputTensor as unknown as { dispose?: () => void }).dispose?.();
        (outTensor as unknown as { dispose?: () => void }).dispose?.();
      } catch {
        /* ignore dispose errors */
      }

      completedTiles += 1;
      const pct = 42 + Math.round((completedTiles / totalTiles) * 56);
      post({
        type: 'CLARIFY_PROGRESS',
        id: jobId,
        percent: Math.min(98, pct),
        label: `REAL-ESRGAN 4X // TILE ${completedTiles}/${totalTiles}`,
      });
    }
  }

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
    const autoAiCap = hasGpu ? (preferMobileSafe ? 512 : 768) : 360;
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;

    const shouldTryAi =
      mode === 'ai' || (mode === 'auto' && isOnline && !offlineOnly && longest <= autoAiCap);

    if (shouldTryAi) {
      try {
        const result = await runTiledRealEsrgan(bitmap, preferMobileSafe, id);
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
        console.warn('[KILOWASH CLARIFY] Real-ESRGAN unavailable, falling back to Steam DSP:', err);
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

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const job = event.data;

  switch (job.type) {
    case 'SEGMENT':
      runSegmentation(job).catch((err) => {
        post({ type: 'JOB_ERROR', id: job.id, message: errorMessage(err) });
      });
      return;
    case 'CLARIFY':
      runClarifyJob(job).catch((err) => {
        post({ type: 'JOB_ERROR', id: job.id, message: errorMessage(err) });
      });
      return;
    case 'ENCODE_PNG':
      runPngEncoding(job).catch((err) => {
        post({ type: 'JOB_ERROR', id: job.id, message: errorMessage(err) });
      });
      return;
    case 'ENCODE_GIF':
      runGifEncoding(job).catch((err) => {
        post({ type: 'JOB_ERROR', id: job.id, message: errorMessage(err) });
      });
      return;
  }
};
