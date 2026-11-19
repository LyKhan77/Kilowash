/**
 * Message protocol between the main UI thread and src/workers/mediaWorker.ts.
 * Heavy compute (RMBG-1.4 inference, Sobel fallback, GIF quantization) lives in the worker
 * so the drum rotation, 3D operator and Web Audio loops stay at 60 FPS.
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

export type WorkerRequest = SegmentJob | GifJob | PngJob;

export type WorkerResponse =
  | { type: 'MODEL_PROGRESS'; id: number; percent: number; label: string }
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
  | { type: 'GIF_DONE'; id: number; blob: Blob; width: number; height: number }
  | { type: 'PNG_DONE'; id: number; blob: Blob; width: number; height: number }
  | { type: 'JOB_ERROR'; id: number; message: string };
