import { segmentInWorker } from './mediaWorkerClient';

/**
 * Removes the background from a canvas using briaai/RMBG-1.4 running inside the dedicated
 * media worker (WebGPU fp16 when an adapter is available, WASM q8 otherwise, with the
 * Sobel edge-barrier segmentation as an offline fallback).
 *
 * Everything heavy — model download, inference, mask compositing — happens off the main
 * thread, so the drum, 3D operator and Web Audio loops keep running at 60 FPS.
 */
export async function removeBackgroundFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  onModelProgress?: (percent: number, label?: string) => void,
  prevAlphaMask?: Float32Array | null
): Promise<{ canvas: HTMLCanvasElement; alphaMask: Float32Array; usedFallback: boolean }> {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  const sourceBitmap = await createImageBitmap(sourceCanvas);
  const result = await segmentInWorker(sourceBitmap, prevAlphaMask ?? null, (percent, label) => {
    onModelProgress?.(percent, label);
  });

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('Canvas 2D context is unavailable.');

  outCtx.drawImage(result.bitmap, 0, 0);
  result.bitmap.close();

  return { canvas: outCanvas, alphaMask: result.mask, usedFallback: result.usedFallback };
}
