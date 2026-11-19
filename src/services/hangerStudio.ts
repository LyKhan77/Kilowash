import { reencodeImageCanvas } from './mediaPipeline';
import type { ImageOutputFormat } from '../types/laundry';

export type ExportBackdropMode = 'none' | 'white' | 'slate' | 'greenscreen' | 'custom';
export type StickerThickness = 'sm' | 'md' | 'lg';

export interface HangerStudioOptions {
  backdrop: ExportBackdropMode;
  customColor: string;
  dropShadow: boolean;
  stickerOutline: boolean;
  stickerSize: StickerThickness;
}

export const DEFAULT_HANGER_STUDIO: HangerStudioOptions = {
  backdrop: 'none',
  customColor: '#FFE600',
  dropShadow: false,
  stickerOutline: false,
  stickerSize: 'md',
};

export function hasActiveHangerFx(opts: HangerStudioOptions): boolean {
  return opts.backdrop !== 'none' || opts.dropShadow || opts.stickerOutline;
}

export function resolveBackdropColor(opts: HangerStudioOptions): string | null {
  switch (opts.backdrop) {
    case 'white':
      return '#FFFFFF';
    case 'slate':
      return '#0F172A';
    case 'greenscreen':
      return '#00FF00';
    case 'custom':
      return opts.customColor || '#FFE600';
    default:
      return null;
  }
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for Hanger Studio export.'));
    img.src = url;
  });
}

function buildWhiteSilhouette(img: HTMLImageElement): HTMLCanvasElement {
  const sil = document.createElement('canvas');
  sil.width = img.naturalWidth;
  sil.height = img.naturalHeight;
  const ctx = sil.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, sil.width, sil.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return sil;
}

/**
 * Composites non-destructive Scene 2 export effects (die-cut white sticker outline,
 * soft drop shadow, and solid marketplace/brand backdrop) and re-encodes using the
 * receipt's active Target-MB & format rules.
 */
export async function renderHangerStudioImage(params: {
  baseUrl: string;
  options: HangerStudioOptions;
  format: ImageOutputFormat;
  enforceTargetMB: boolean;
  targetMB: number;
}): Promise<{ blob: Blob; width: number; height: number }> {
  const { baseUrl, options, format, enforceTargetMB, targetMB } = params;
  const img = await loadImg(baseUrl);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const refDim = Math.max(srcW, srcH);

  const outlineScale =
    options.stickerSize === 'sm' ? 0.014 : options.stickerSize === 'lg' ? 0.034 : 0.022;
  const outlinePx = options.stickerOutline
    ? Math.max(4, Math.min(40, Math.round(refDim * outlineScale)))
    : 0;

  const shadowBlur = options.dropShadow ? Math.max(10, Math.round(refDim * 0.032)) : 0;
  const shadowOffsetY = options.dropShadow ? Math.max(5, Math.round(refDim * 0.016)) : 0;
  const shadowPad = options.dropShadow ? shadowBlur + shadowOffsetY : 0;

  const padX = outlinePx + shadowPad;
  const padTop = outlinePx + (options.dropShadow ? shadowBlur : 0);
  const padBottom = outlinePx + shadowPad;

  const outW = srcW + padX * 2;
  const outH = srcH + padTop + padBottom;

  // Step 1: Build subject layer (with optional die-cut white sticker border)
  const subjectW = srcW + outlinePx * 2;
  const subjectH = srcH + outlinePx * 2;
  const subjectCanvas = document.createElement('canvas');
  subjectCanvas.width = subjectW;
  subjectCanvas.height = subjectH;
  const subjectCtx = subjectCanvas.getContext('2d');
  if (!subjectCtx) throw new Error('Canvas 2D context is unavailable.');

  if (outlinePx > 0) {
    const silhouette = buildWhiteSilhouette(img);
    const outerSteps = 20;
    for (let i = 0; i < outerSteps; i++) {
      const angle = (i * Math.PI * 2) / outerSteps;
      subjectCtx.drawImage(
        silhouette,
        outlinePx + Math.cos(angle) * outlinePx,
        outlinePx + Math.sin(angle) * outlinePx
      );
    }
    const midSteps = 10;
    const midR = outlinePx * 0.5;
    for (let i = 0; i < midSteps; i++) {
      const angle = (i * Math.PI * 2) / midSteps;
      subjectCtx.drawImage(
        silhouette,
        outlinePx + Math.cos(angle) * midR,
        outlinePx + Math.sin(angle) * midR
      );
    }
  }
  subjectCtx.drawImage(img, outlinePx, outlinePx);

  // Step 2: Composite onto final canvas with optional drop shadow & solid backdrop
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('Canvas 2D context is unavailable.');

  if (options.dropShadow) {
    outCtx.shadowColor = 'rgba(15, 23, 42, 0.42)';
    outCtx.shadowBlur = shadowBlur;
    outCtx.shadowOffsetX = 0;
    outCtx.shadowOffsetY = shadowOffsetY;
  }

  outCtx.drawImage(subjectCanvas, shadowPad, options.dropShadow ? shadowBlur : 0);
  outCtx.shadowColor = 'transparent';
  outCtx.shadowBlur = 0;
  outCtx.shadowOffsetY = 0;

  const bgColor = resolveBackdropColor(options);
  if (bgColor) {
    outCtx.globalCompositeOperation = 'destination-over';
    outCtx.fillStyle = bgColor;
    outCtx.fillRect(0, 0, outW, outH);
    outCtx.globalCompositeOperation = 'source-over';
  }

  return reencodeImageCanvas(outCanvas, {
    format,
    enforceTargetMB,
    targetMB,
  });
}
