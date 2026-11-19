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

export interface LoadedMedia {
  file: File;
  kind: MediaKind;
  objectUrl: string;
  width: number;
  height: number;
  durationSec: number;
  sizeMB: number;
}
