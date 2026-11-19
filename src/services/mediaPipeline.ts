import type {
  CropBox,
  ImageOutputFormat,
  LaundryCycle,
  LaundryReceipt,
  VideoOutputFormat,
  VideoTrim,
  WashProgress,
} from '../types/laundry';
import { removeBackgroundFromCanvas } from './aiBackgroundRemover';
import { encodeGifInWorker, encodePngInWorker } from './mediaWorkerClient';

const MAX_WORKING_VIDEO_DIM = 640;
const MAX_PREVIEW_DIM = 480;

/**
 * Data URL for the drum previews. The drum is a few hundred pixels wide, so encoding a
 * 24 MP canvas (measured 1.0 s of main-thread block) buys nothing but a larger string to
 * carry through React state. Downscale to MAX_PREVIEW_DIM first.
 */
function previewDataUrl(source: HTMLCanvasElement): string {
  const longest = Math.max(source.width, source.height);
  if (longest <= MAX_PREVIEW_DIM) {
    return source.toDataURL('image/png');
  }

  const scale = MAX_PREVIEW_DIM / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return source.toDataURL('image/png');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024);
}

export function cropSourceToCanvas(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  crop: CropBox,
  maxDim?: number
): HTMLCanvasElement {
  const sx = Math.max(0, Math.round(crop.x * srcWidth));
  const sy = Math.max(0, Math.round(crop.y * srcHeight));
  const sw = Math.max(16, Math.round(crop.width * srcWidth));
  const sh = Math.max(16, Math.round(crop.height * srcHeight));

  let dw = sw;
  let dh = sh;
  if (maxDim && Math.max(dw, dh) > maxDim) {
    const ratio = maxDim / Math.max(dw, dh);
    dw = Math.max(16, Math.round(dw * ratio));
    dh = Math.max(16, Math.round(dh * ratio));
  }

  // Ensure even dimensions for video encoders
  dw = Math.max(2, dw - (dw % 2));
  dh = Math.max(2, dh - (dh % 2));

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');

  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
  return canvas;
}

function scaleCanvas(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const w = Math.max(24, Math.round((source.width * scale) / 2) * 2);
  const h = Math.max(24, Math.round((source.height * scale) / 2) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

function compositeOnSolidColor(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`Failed to encode to ${mime}.`))),
      mime,
      quality
    );
  });
}

/**
 * Binary-searches quality & adaptive scale until the resulting image blob
 * fits strictly under `targetMB`.
 */
async function compressCanvasToTargetMB(
  canvas: HTMLCanvasElement,
  format: ImageOutputFormat,
  targetMB: number,
  onProgress?: (p: WashProgress) => void
): Promise<{ blob: Blob; width: number; height: number }> {
  const targetBytes = Math.max(8 * 1024, Math.floor(targetMB * 1024 * 1024 * 0.98));
  const mime =
    format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';

  const prepCanvas = (c: HTMLCanvasElement) =>
    format === 'jpeg' ? compositeOnSolidColor(c, '#FFFFFF') : c;

  if (format === 'png') {
    // Entire palette/scale descent runs in the media worker (main-thread safe).
    return encodePngInWorker(canvas, {
      targetBytes,
      scales: [1, 0.85, 0.7, 0.55, 0.42, 0.3, 0.2],
      colorBudgets: [256, 128, 64, 32],
    });
  }

  // Lossy binary search for WebP & JPEG
  const scales = [1, 0.85, 0.7, 0.55, 0.4, 0.28, 0.18];
  let globalBest: { blob: Blob; width: number; height: number } | null = null;

  for (let si = 0; si < scales.length; si++) {
    const working = prepCanvas(scales[si] === 1 ? canvas : scaleCanvas(canvas, scales[si]));
    let low = 0.04;
    let high = 0.96;
    let bestAtScale: Blob | null = null;

    // Quick upper-bound check
    const maxQBlob = await canvasToBlob(working, mime, high);
    if (maxQBlob.size <= targetBytes) {
      return { blob: maxQBlob, width: working.width, height: working.height };
    }

    for (let iter = 0; iter < 7; iter++) {
      const mid = (low + high) / 2;
      const candidate = await canvasToBlob(working, mime, mid);

      if (!globalBest || candidate.size < globalBest.blob.size) {
        globalBest = { blob: candidate, width: working.width, height: working.height };
      }

      onProgress?.({
        phase: 'spinning',
        percent: Math.min(96, 62 + Math.round(((si * 7 + iter + 1) / (scales.length * 7)) * 34)),
        statusText: `SPIN SOLVER // ${bytesToMB(candidate.size).toFixed(2)} MB (Q=${Math.round(
          mid * 100
        )}%)`,
        currentSizeMB: bytesToMB(candidate.size),
      });

      if (candidate.size <= targetBytes) {
        bestAtScale = candidate;
        low = mid;
      } else {
        high = mid;
      }
      await yieldToMain();
    }

    if (bestAtScale) {
      return { blob: bestAtScale, width: working.width, height: working.height };
    }
  }

  return (
    globalBest ?? {
      blob: await canvasToBlob(prepCanvas(canvas), mime, 0.5),
      width: canvas.width,
      height: canvas.height,
    }
  );
}

function encodeCanvasDirect(
  canvas: HTMLCanvasElement,
  format: ImageOutputFormat
): Promise<{ blob: Blob; width: number; height: number }> {
  const mime =
    format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  const readyCanvas =
    format === 'jpeg' ? compositeOnSolidColor(canvas, '#FFFFFF') : canvas;
  return canvasToBlob(readyCanvas, mime, 0.94).then((blob) => ({
    blob,
    width: canvas.width,
    height: canvas.height,
  }));
}

/**
 * Re-encodes an image canvas using the active cycle's output rules (runs the Target-MB
 * solver when `enforceTargetMB` is true, otherwise encodes directly at high quality).
 */
export async function reencodeImageCanvas(
  canvas: HTMLCanvasElement,
  options: {
    format: ImageOutputFormat;
    enforceTargetMB: boolean;
    targetMB: number;
  }
): Promise<{ blob: Blob; width: number; height: number }> {
  if (options.enforceTargetMB) {
    return compressCanvasToTargetMB(canvas, options.format, options.targetMB);
  }
  return encodeCanvasDirect(canvas, options.format);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTheatricalStage(params: {
  phase: WashProgress['phase'];
  fromPct: number;
  toPct: number;
  durationMs: number;
  statusText: string;
  previewDataUrl?: string;
  onProgress: (p: WashProgress) => void;
  pauseWhen?: () => boolean;
}): Promise<void> {
  const {
    phase,
    fromPct,
    toPct,
    durationMs,
    statusText,
    previewDataUrl,
    onProgress,
    pauseWhen,
  } = params;
  const steps = Math.max(4, Math.round(durationMs / 120));
  const stepMs = durationMs / steps;

  for (let i = 0; i <= steps; i++) {
    if (!pauseWhen?.()) {
      const pct = Math.round(fromPct + ((toPct - fromPct) * i) / steps);
      onProgress({
        phase,
        percent: pct,
        statusText,
        previewDataUrl,
      });
    }
    if (i < steps) {
      await sleep(stepMs);
    }
  }
}

/**
 * Complete client-side Image Laundry pipeline with multi-stage theatrical cleaning timeline:
 * Fill Water -> Deep Scrub + RMBG-1.4 AI Wash -> Rinse & Drain -> High-Speed Spin MB -> Dry Line.
 */
export async function processImageLaundry(params: {
  file: File;
  objectUrl: string;
  cycle: LaundryCycle;
  crop: CropBox;
  targetMB: number;
  outputFormat: ImageOutputFormat;
  onProgress: (p: WashProgress) => void;
}): Promise<LaundryReceipt> {
  const { file, objectUrl, cycle, crop, targetMB, outputFormat, onProgress } = params;
  const startedAt = performance.now();

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to read image file.'));
    el.src = objectUrl;
  });

  let workingCanvas = cropSourceToCanvas(img, img.naturalWidth, img.naturalHeight, crop);
  const inputPreviewUrl = previewDataUrl(workingCanvas);

  // Stage 1: Locking Door & Filling Water
  await runTheatricalStage({
    phase: 'filling',
    fromPct: 2,
    toPct: 22,
    durationMs: 1000,
    statusText: '01 // LOCKING DOOR & FILLING WATER...',
    previewDataUrl: inputPreviewUrl,
    onProgress,
  });

  if (cycle === 'wash' || cycle === 'both') {
    let modelIsDownloading = false;

    const aiPromise = removeBackgroundFromCanvas(workingCanvas, (modelPct, label) => {
      modelIsDownloading = modelPct < 100;
      onProgress({
        phase: 'loading-model',
        percent: Math.min(54, 24 + Math.round(modelPct * 0.3)),
        statusText: label ?? 'LOADING RMBG-1.4 AI...',
        previewDataUrl: inputPreviewUrl,
      });
    }).then((res) => {
      modelIsDownloading = false;
      return res;
    });

    // Stage 2: Deep Scrub & AI Stain Removal (runs concurrently with inference)
    const scrubAnimPromise = runTheatricalStage({
      phase: 'washing',
      fromPct: 22,
      toPct: 58,
      durationMs: 1850,
      statusText: '02 // DEEP SCRUB & AI STAIN REMOVAL...',
      previewDataUrl: inputPreviewUrl,
      onProgress,
      pauseWhen: () => modelIsDownloading,
    });

    const [washed] = await Promise.all([aiPromise, scrubAnimPromise]);
    workingCanvas = washed.canvas;
    const cutoutPreviewUrl = previewDataUrl(workingCanvas);

    // Stage 3: Rinsing & Draining Dirty Background
    await runTheatricalStage({
      phase: 'rinsing',
      fromPct: 58,
      toPct: 76,
      durationMs: 1100,
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

  if (cycle === 'spin' || cycle === 'both') {
    const spinStartPct = cycle === 'spin' ? 22 : 76;
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
      durationMs: cycle === 'spin' ? 2200 : 1150,
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
      fromPct: 76,
      toPct: 96,
      durationMs: 950,
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

  const formatLabelMap: Record<ImageOutputFormat, string> = {
    webp: 'WebP Transparent',
    png: 'PNG Transparent',
    jpeg: 'JPG Solid',
  };

  const receipt: LaundryReceipt = {
    fileName: file.name,
    mediaKind: 'image',
    cycle,
    originalSizeMB,
    finalSizeMB,
    targetMB,
    savedPercent,
    width: finalWidth,
    height: finalHeight,
    formatLabel: formatLabelMap[outputFormat],
    fileExtension: outputFormat === 'jpeg' ? 'jpg' : outputFormat,
    durationMs: Math.round(performance.now() - startedAt),
    frameCount: 1,
    outputUrl: URL.createObjectURL(finalBlob),
    outputBlob: finalBlob,
  };

  return receipt;
}

interface BrowserImageDecoder {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(opts: { frameIndex: number }): Promise<{ image: VideoFrame & { close(): void; duration?: number } }>;
  close(): void;
}

/**
 * Extracts cropped frames from an animated GIF using WebCodecs ImageDecoder when available.
 */
async function extractGifFrames(
  file: File,
  crop: CropBox,
  trim: VideoTrim,
  onProgress: (p: WashProgress) => void
): Promise<{ frames: HTMLCanvasElement[]; durationSec: number } | null> {
  const DecoderCtor = (
    window as unknown as {
      ImageDecoder?: new (init: { data: ArrayBuffer; type: string }) => BrowserImageDecoder;
    }
  ).ImageDecoder;
  if (!DecoderCtor) return null;

  const buffer = await file.arrayBuffer();
  const decoder = new DecoderCtor({ data: buffer, type: 'image/gif' });
  await decoder.tracks.ready;

  const rawCount = decoder.tracks.selectedTrack?.frameCount ?? 1;
  if (rawCount <= 1) {
    decoder.close();
    return null;
  }

  const maxFrames = Math.min(rawCount, trim.fps * 8);
  const step = Math.max(1, rawCount / maxFrames);
  const frames: HTMLCanvasElement[] = [];

  for (let i = 0; i < maxFrames; i++) {
    const frameIndex = Math.min(rawCount - 1, Math.floor(i * step));
    const decoded = await decoder.decode({ frameIndex });
    const imgFrame = decoded.image;
    const frameCanvas = cropSourceToCanvas(
      imgFrame as unknown as CanvasImageSource,
      imgFrame.displayWidth || imgFrame.codedWidth,
      imgFrame.displayHeight || imgFrame.codedHeight,
      crop,
      MAX_WORKING_VIDEO_DIM
    );
    imgFrame.close();
    frames.push(frameCanvas);

    onProgress({
      phase: 'extracting',
      percent: Math.round(((i + 1) / maxFrames) * 18),
      statusText: `EXTRACTING GIF FRAME ${i + 1}/${maxFrames}...`,
      currentFrame: i + 1,
      totalFrames: maxFrames,
    });
    await yieldToMain();
  }

  decoder.close();
  return { frames, durationSec: Math.max(0.5, frames.length / trim.fps) };
}

/**
 * Extracts cropped frames from a `<video>` file over `[trim.start, trim.end]` (max 8s).
 */
async function extractVideoFrames(
  file: File,
  objectUrl: string,
  crop: CropBox,
  trim: VideoTrim,
  onProgress: (p: WashProgress) => void
): Promise<{ frames: HTMLCanvasElement[]; durationSec: number }> {
  if (file.type === 'image/gif') {
    const gifData = await extractGifFrames(file, crop, trim, onProgress);
    if (gifData) return gifData;
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.src = objectUrl;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video metadata.'));
  });

  const safeStart = Math.max(0, Math.min(trim.start, Math.max(0, video.duration - 0.2)));
  const rawEnd = trim.end > safeStart ? trim.end : Math.min(video.duration, safeStart + 8);
  const safeEnd = Math.min(video.duration, safeStart + Math.min(8, rawEnd - safeStart));
  const durationSec = Math.max(0.4, safeEnd - safeStart);

  const totalFrames = Math.max(2, Math.min(120, Math.round(durationSec * trim.fps)));
  const stepSec = durationSec / totalFrames;
  const frames: HTMLCanvasElement[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const t = Math.min(video.duration - 0.01, safeStart + i * stepSec);
    await new Promise<void>((resolve) => {
      const handleSeeked = () => {
        video.removeEventListener('seeked', handleSeeked);
        resolve();
      };
      video.addEventListener('seeked', handleSeeked);
      video.currentTime = t;
    });

    const frameCanvas = cropSourceToCanvas(
      video,
      video.videoWidth,
      video.videoHeight,
      crop,
      MAX_WORKING_VIDEO_DIM
    );
    frames.push(frameCanvas);

    onProgress({
      phase: 'extracting',
      percent: Math.round(((i + 1) / totalFrames) * 18),
      statusText: `EXTRACTING FRAME ${i + 1}/${totalFrames}...`,
      currentFrame: i + 1,
      totalFrames,
    });
    await yieldToMain();
  }

  return { frames, durationSec };
}

/**
 * Encodes frames into WebM (transparent or solid #00FF00 green screen) via MediaRecorder
 * with bitrate budgeting for target MB.
 */
async function encodeFramesToWebm(
  frames: HTMLCanvasElement[],
  fps: number,
  durationSec: number,
  targetBytes: number,
  enforceTargetMB: boolean,
  greenScreen: boolean,
  scale: number
): Promise<{ blob: Blob; width: number; height: number }> {
  const scaledFrames = scale === 1 ? frames : frames.map((f) => scaleCanvas(f, scale));
  const width = scaledFrames[0].width;
  const height = scaledFrames[0].height;

  const recCanvas = document.createElement('canvas');
  recCanvas.width = width;
  recCanvas.height = height;
  const recCtx = recCanvas.getContext('2d');
  if (!recCtx) throw new Error('Canvas 2D context is unavailable.');

  const drawFrame = (frame: HTMLCanvasElement) => {
    recCtx.clearRect(0, 0, width, height);
    if (greenScreen) {
      recCtx.fillStyle = '#00FF00';
      recCtx.fillRect(0, 0, width, height);
    }
    recCtx.drawImage(frame, 0, 0, width, height);
  };

  drawFrame(scaledFrames[0]);

  const bps = enforceTargetMB
    ? Math.max(60_000, Math.floor((targetBytes * 8 * 0.85) / Math.max(0.5, durationSec)))
    : 1_800_000;

  const preferredMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const stream = recCanvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: preferredMime,
    videoBitsPerSecond: bps,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };
  });

  const frameDelayMs = Math.round(1000 / fps);
  recorder.start(100);

  for (let i = 0; i < scaledFrames.length; i++) {
    drawFrame(scaledFrames[i]);
    await new Promise((r) => setTimeout(r, frameDelayMs));
  }

  recorder.stop();
  const blob = await stopped;
  return { blob, width, height };
}

/**
 * Complete client-side Video/Meme Laundry pipeline:
 * Extract cropped frames -> AI Wash per-frame with temporal smoothing -> Encode GIF/WebM/GreenScreen + Target MB.
 */
export async function processVideoLaundry(params: {
  file: File;
  objectUrl: string;
  cycle: LaundryCycle;
  crop: CropBox;
  trim: VideoTrim;
  targetMB: number;
  outputFormat: VideoOutputFormat;
  onProgress: (p: WashProgress) => void;
}): Promise<LaundryReceipt> {
  const { file, objectUrl, cycle, crop, trim, targetMB, outputFormat, onProgress } = params;
  const startedAt = performance.now();

  const { frames, durationSec } = await extractVideoFrames(
    file,
    objectUrl,
    crop,
    trim,
    onProgress
  );

  let processedFrames = frames;
  if (cycle === 'wash' || cycle === 'both') {
    const washedFrames: HTMLCanvasElement[] = [];
    let prevMask: Float32Array | null = null;

    for (let i = 0; i < frames.length; i++) {
      const res = await removeBackgroundFromCanvas(
        frames[i],
        (modelPct, label) => {
          if (i === 0) {
            onProgress({
              phase: 'loading-model',
              percent: Math.min(35, 18 + Math.round(modelPct * 0.17)),
              statusText: label ?? 'LOADING AI VIDEO SEGMENTER...',
            });
          }
        },
        prevMask
      );

      prevMask = res.alphaMask;
      washedFrames.push(res.canvas);

      const washPct = 36 + Math.round(((i + 1) / frames.length) * 38);
      onProgress({
        phase: 'washing',
        percent: washPct,
        statusText: `AI WASH FRAME ${i + 1}/${frames.length}`,
        currentFrame: i + 1,
        totalFrames: frames.length,
        previewDataUrl: previewDataUrl(res.canvas),
      });
      await yieldToMain();
    }

    processedFrames = washedFrames;
  }

  const enforceTarget = cycle === 'spin' || cycle === 'both';
  const targetBytes = Math.max(24 * 1024, Math.floor(targetMB * 1024 * 1024 * 0.98));

  let finalResult: { blob: Blob; width: number; height: number };

  if (outputFormat === 'gif') {
    const colorSteps = enforceTarget ? [256, 128, 64, 32] : [256];
    const scaleSteps = enforceTarget ? [1, 0.85, 0.7, 0.55, 0.4] : [1];

    onProgress({
      phase: enforceTarget ? 'spinning' : 'encoding',
      percent: 76,
      statusText: enforceTarget ? 'SPIN GIF // QUANTIZING...' : 'ENCODING TRANSPARENT GIF...',
    });

    // Frames travel to the worker as zero-copy bitmaps; the color/scale descent runs there.
    const frameBitmaps: ImageBitmap[] = [];
    for (const frame of processedFrames) {
      frameBitmaps.push(await createImageBitmap(frame));
    }

    finalResult = await encodeGifInWorker(
      frameBitmaps,
      {
        fps: trim.fps,
        colorSteps,
        scaleSteps,
        targetBytes: enforceTarget ? targetBytes : null,
      },
      (step, total, label) => {
        onProgress({
          phase: enforceTarget ? 'spinning' : 'encoding',
          percent: Math.min(96, 76 + Math.round((step / total) * 20)),
          statusText: enforceTarget ? `SPIN GIF // ${label}` : 'ENCODING TRANSPARENT GIF...',
        });
      }
    );
  } else {
    const greenScreen = outputFormat === 'greenscreen';
    onProgress({
      phase: enforceTarget ? 'spinning' : 'encoding',
      percent: 82,
      statusText: greenScreen
        ? 'ENCODING GREEN SCREEN (#00FF00)...'
        : 'ENCODING TRANSPARENT WEBM...',
    });

    finalResult = await encodeFramesToWebm(
      processedFrames,
      trim.fps,
      durationSec,
      targetBytes,
      enforceTarget,
      greenScreen,
      1
    );

    if (enforceTarget && finalResult.blob.size > targetBytes) {
      const downScale = Math.max(
        0.35,
        Math.min(0.85, Math.sqrt(targetBytes / finalResult.blob.size) * 0.9)
      );
      onProgress({
        phase: 'spinning',
        percent: 92,
        statusText: `RE-SPINNING WEBM TO <= ${targetMB.toFixed(2)} MB...`,
        currentSizeMB: bytesToMB(finalResult.blob.size),
      });
      finalResult = await encodeFramesToWebm(
        processedFrames,
        trim.fps,
        durationSec,
        targetBytes,
        true,
        greenScreen,
        downScale
      );
    }
  }

  const originalSizeMB = bytesToMB(file.size);
  const finalSizeMB = bytesToMB(finalResult.blob.size);
  const savedPercent =
    originalSizeMB > 0
      ? Math.round(((originalSizeMB - finalSizeMB) / originalSizeMB) * 100)
      : 0;

  const formatLabels: Record<VideoOutputFormat, { label: string; ext: string }> = {
    gif: { label: 'GIF Transparent', ext: 'gif' },
    webm: { label: 'WebM Transparent', ext: 'webm' },
    greenscreen: { label: 'Video Green Screen (#00FF00)', ext: 'webm' },
  };

  const receipt: LaundryReceipt = {
    fileName: file.name,
    mediaKind: 'video',
    cycle,
    originalSizeMB,
    finalSizeMB,
    targetMB,
    savedPercent,
    width: finalResult.width,
    height: finalResult.height,
    formatLabel: formatLabels[outputFormat].label,
    fileExtension: formatLabels[outputFormat].ext,
    durationMs: Math.round(performance.now() - startedAt),
    frameCount: processedFrames.length,
    outputUrl: URL.createObjectURL(finalResult.blob),
    outputBlob: finalResult.blob,
  };

  onProgress({
    phase: 'done',
    percent: 100,
    statusText: '05 // CYCLE COMPLETE — HANGING TO DRY',
    currentSizeMB: finalSizeMB,
  });
  await sleep(280);

  return receipt;
}
