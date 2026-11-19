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
