import type { WorkerRequest, WorkerResponse } from '../types/workerMessages';

/**
 * Main-thread client for src/workers/mediaWorker.ts.
 * Keeps a single long-lived worker (so the RMBG-1.4 session is loaded only once) and
 * routes progress/results back to the awaiting job. A crashed worker is discarded and
 * respawned on the next request.
 */

interface JobHandlers {
  onModelProgress?: (percent: number, label: string) => void;
  onGifProgress?: (step: number, total: number, label: string) => void;
}

interface PendingJob {
  resolve: (message: WorkerResponse) => void;
  reject: (err: Error) => void;
  handlers: JobHandlers;
  silenceTimer: number;
}

export interface SegmentationResult {
  bitmap: ImageBitmap;
  mask: Float32Array;
  usedFallback: boolean;
}

export interface GifEncodingOptions {
  fps: number;
  colorSteps: number[];
  scaleSteps: number[];
  targetBytes: number | null;
}

/**
 * A job is aborted only when it has been silent for this long. Most phases report often
 * (model download chunks, one message per frame, one per GIF/PNG attempt), but the WASM
 * fallback does its ONNX session creation + first 1024² inference inside a single opaque
 * `await`: measured 110 s on a Chromium build without SIMD/threads. A liveness heartbeat
 * cannot cover that honestly, so the window is generous — it only exists to unstick a
 * truly dead worker instead of spinning forever.
 */
const JOB_SILENCE_LIMIT_MS = 300_000;

const pending = new Map<number, PendingJob>();
let worker: Worker | null = null;
let nextJobId = 1;

function silenceTimeoutMessage(): string {
  return `Media worker stopped responding for ${Math.round(
    JOB_SILENCE_LIMIT_MS / 1000
  )}s — cycle aborted.`;
}

function armSilenceTimer(): number {
  return window.setTimeout(() => {
    failAllPending(silenceTimeoutMessage());
  }, JOB_SILENCE_LIMIT_MS);
}

function failAllPending(message: string): void {
  const jobs = Array.from(pending.values());
  pending.clear();
  worker?.terminate();
  worker = null;
  for (const job of jobs) {
    window.clearTimeout(job.silenceTimer);
    job.reject(new Error(message));
  }
}

function handleMessage(message: WorkerResponse): void {
  const job = pending.get(message.id);
  if (!job) return;

  window.clearTimeout(job.silenceTimer);

  switch (message.type) {
    case 'MODEL_PROGRESS':
      job.handlers.onModelProgress?.(message.percent, message.label);
      job.silenceTimer = armSilenceTimer();
      return;
    case 'GIF_PROGRESS':
      job.handlers.onGifProgress?.(message.step, message.total, message.label);
      job.silenceTimer = armSilenceTimer();
      return;
    case 'PNG_PROGRESS':
      job.silenceTimer = armSilenceTimer();
      return;
    case 'JOB_ERROR':
      pending.delete(message.id);
      job.reject(new Error(message.message));
      return;
    case 'SEGMENT_DONE':
    case 'GIF_DONE':
    case 'PNG_DONE':
      pending.delete(message.id);
      job.resolve(message);
      return;
  }
}

function ensureWorker(): Worker {
  if (worker) return worker;

  const instance = new Worker(new URL('../workers/mediaWorker.ts', import.meta.url), {
    type: 'module',
  });
  instance.onmessage = (event: MessageEvent<WorkerResponse>) => handleMessage(event.data);
  instance.onerror = (event: ErrorEvent) => {
    failAllPending(event.message || 'Media worker failed to start.');
  };
  instance.onmessageerror = () => {
    failAllPending('Media worker message could not be deserialized.');
  };

  worker = instance;
  return instance;
}

function request(
  message: WorkerRequest,
  transfer: Transferable[],
  handlers: JobHandlers
): Promise<WorkerResponse> {
  const instance = ensureWorker();

  return new Promise<WorkerResponse>((resolve, reject) => {
    const job: PendingJob = { resolve, reject, handlers, silenceTimer: 0 };
    pending.set(message.id, job);
    job.silenceTimer = armSilenceTimer();
    try {
      instance.postMessage(message, transfer);
    } catch (err) {
      window.clearTimeout(job.silenceTimer);
      pending.delete(message.id);
      reject(err instanceof Error ? err : new Error('Media worker rejected the job.'));
    }
  });
}

/**
 * Segments one frame on the worker thread. The bitmap and the previous mask are
 * transferred (zero-copy), so callers must not reuse either after this call.
 */
export async function segmentInWorker(
  bitmap: ImageBitmap,
  prevMask: Float32Array | null,
  onModelProgress?: (percent: number, label: string) => void
): Promise<SegmentationResult> {
  const id = nextJobId++;
  const transfer: Transferable[] = [bitmap];
  if (prevMask) transfer.push(prevMask.buffer as ArrayBuffer);

  const message = await request({ type: 'SEGMENT', id, bitmap, prevMask }, transfer, {
    onModelProgress,
  });

  if (message.type !== 'SEGMENT_DONE') {
    throw new Error('Unexpected response from the media worker.');
  }

  return { bitmap: message.bitmap, mask: message.mask, usedFallback: message.usedFallback };
}

/**
 * Runs the PNG Target-MB solver on the worker thread. The canvas is snapshotted into a
 * transferable bitmap, so the caller keeps its canvas untouched.
 */
export async function encodePngInWorker(
  source: HTMLCanvasElement,
  options: { targetBytes: number; scales: number[]; colorBudgets: number[] }
): Promise<{ blob: Blob; width: number; height: number }> {
  const id = nextJobId++;
  const bitmap = await createImageBitmap(source);

  const message = await request(
    {
      type: 'ENCODE_PNG',
      id,
      bitmap,
      targetBytes: options.targetBytes,
      scales: options.scales,
      colorBudgets: options.colorBudgets,
    },
    [bitmap],
    {}
  );

  if (message.type !== 'PNG_DONE') {
    throw new Error('Unexpected response from the media worker.');
  }

  return { blob: message.blob, width: message.width, height: message.height };
}

/**
 * Runs the entire GIF Target-MB solver on the worker thread. Frame bitmaps are
 * transferred and closed by the worker.
 */
export async function encodeGifInWorker(
  frames: ImageBitmap[],
  options: GifEncodingOptions,
  onProgress?: (step: number, total: number, label: string) => void
): Promise<{ blob: Blob; width: number; height: number }> {
  const id = nextJobId++;

  const message = await request(
    {
      type: 'ENCODE_GIF',
      id,
      frames,
      fps: options.fps,
      colorSteps: options.colorSteps,
      scaleSteps: options.scaleSteps,
      targetBytes: options.targetBytes,
    },
    frames,
    { onGifProgress: onProgress }
  );

  if (message.type !== 'GIF_DONE') {
    throw new Error('Unexpected response from the media worker.');
  }

  return { blob: message.blob, width: message.width, height: message.height };
}
