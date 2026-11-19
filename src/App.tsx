import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ShieldCheck,
  Volume2,
  VolumeX,
  WashingMachine,
  Wind,
} from 'lucide-react';
import { ThemeToggle } from './components/ThemeToggle';
import { CreatorSpotlight, type VoxelOperatorState } from './components/CreatorSpotlight';
import { LaundryMachine } from './components/LaundryMachine';
import { LaundryBasketFixture, WallDispenserRackFixture } from './components/RoomFixtures';
import { DryingLineScene } from './components/DryingLineScene';
import { processImageLaundry, processVideoLaundry } from './services/mediaPipeline';
import {
  createSampleBlurryImageFile,
  createSampleMemeImageFile,
  createSampleMemeVideoFile,
} from './utils/sampleMedia';
import {
  playCycleCompleteChime,
  playDoorLatch,
  playMechanicalClick,
  playRotaryDialTick,
  setSfxMuted,
  syncWashPhaseLoop,
} from './utils/laundrySfx';
import type {
  ClarifyOptions,
  CropBox,
  ImageOutputFormat,
  LaundryCycle,
  LaundryReceipt,
  LoadedMedia,
  RoomScene,
  ThemeShift,
  VideoOutputFormat,
  VideoTrim,
  WashProgress,
} from './types/laundry';

const DEFAULT_CROP: CropBox = { x: 0, y: 0, width: 1, height: 1 };

const IDLE_PROGRESS: WashProgress = {
  phase: 'idle',
  percent: 0,
  statusText: 'READY',
};

const CYCLE_ACCENT_MAP: Record<LaundryCycle, string> = {
  wash: '#00E5FF',
  spin: '#FF5416',
  both: '#FFE600',
  clarify: '#22C55E',
};

async function detectAnimatedGifDuration(file: File): Promise<number | null> {
  try {
    const DecoderCtor = (
      window as unknown as {
        ImageDecoder?: new (init: { data: ArrayBuffer; type: string }) => {
          tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
          close(): void;
        };
      }
    ).ImageDecoder;
    if (!DecoderCtor) return null;

    const decoder = new DecoderCtor({ data: await file.arrayBuffer(), type: 'image/gif' });
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
    decoder.close();
    if (count > 1) {
      return Math.max(1.2, Math.min(8, count / 12));
    }
    return null;
  } catch {
    return null;
  }
}

async function inspectLoadedFile(file: File): Promise<LoadedMedia> {
  const objectUrl = URL.createObjectURL(file);
  const sizeMB = file.size / (1024 * 1024);

  if (file.type === 'image/gif') {
    const gifDuration = await detectAnimatedGifDuration(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to read GIF image.'));
      el.src = objectUrl;
    });

    if (gifDuration !== null) {
      return {
        file,
        kind: 'video',
        objectUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
        durationSec: gifDuration,
        sizeMB,
      };
    }

    return {
      file,
      kind: 'image',
      objectUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      durationSec: 0,
      sizeMB,
    };
  }

  if (file.type.startsWith('video/')) {
    const meta = await new Promise<{ width: number; height: number; duration: number }>(
      (resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.onloadedmetadata = () => {
          const safeDur =
            Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 2.5;
          resolve({
            width: video.videoWidth || 480,
            height: video.videoHeight || 480,
            duration: safeDur,
          });
        };
        video.onerror = () => reject(new Error('Video format is not supported by this browser.'));
        video.src = objectUrl;
      }
    );

    return {
      file,
      kind: 'video',
      objectUrl,
      width: meta.width,
      height: meta.height,
      durationSec: meta.duration,
      sizeMB,
    };
  }

  if (file.type.startsWith('image/')) {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Unable to read image format.'));
      el.src = objectUrl;
    });

    return {
      file,
      kind: 'image',
      objectUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      durationSec: 0,
      sizeMB,
    };
  }

  URL.revokeObjectURL(objectUrl);
  throw new Error('Please select an Image (PNG/JPG/WebP/GIF) or Video (MP4/WebM/MOV) file.');
}

const MAX_BATCH_IMAGES = 12;

function revokeMediaList(items: LoadedMedia[]): void {
  for (const item of items) {
    URL.revokeObjectURL(item.objectUrl);
  }
}

function revokeReceiptList(items: LaundryReceipt[]): void {
  for (const item of items) {
    URL.revokeObjectURL(item.outputUrl);
    if (item.beforeUrl) URL.revokeObjectURL(item.beforeUrl);
  }
}

export default function App() {
  const [shift, setShift] = useState<ThemeShift>('day');
  const [activeScene, setActiveScene] = useState<RoomScene>('washer');
  const [cycle, setCycle] = useState<LaundryCycle>('both');
  const [clarify, setClarify] = useState<ClarifyOptions>({
    mode: 'auto',
    withWash: false,
    withSpin: false,
  });
  const [targetMB, setTargetMB] = useState<number>(1.0);
  const [imageFormat, setImageFormat] = useState<ImageOutputFormat>('webp');
  const [videoFormat, setVideoFormat] = useState<VideoOutputFormat>('gif');

  const [queue, setQueue] = useState<LoadedMedia[]>([]);
  const [activeQueueIndex, setActiveQueueIndex] = useState<number>(0);
  const [crop, setCrop] = useState<CropBox>(DEFAULT_CROP);
  const [trim, setTrim] = useState<VideoTrim>({ start: 0, end: 5, fps: 12 });
  const [progress, setProgress] = useState<WashProgress>(IDLE_PROGRESS);
  const [receipts, setReceipts] = useState<LaundryReceipt[]>([]);
  const [activeReceiptIndex, setActiveReceiptIndex] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isGeneratingSample, setIsGeneratingSample] = useState(false);
  const [sfxMuted, setSfxMutedState] = useState<boolean>(false);

  const media = queue[activeQueueIndex] ?? null;
  const receipt = receipts[activeReceiptIndex] ?? null;
  const prevPhaseRef = useRef<WashProgress['phase']>('idle');
  const queueRef = useRef<LoadedMedia[]>([]);
  const receiptsRef = useRef<LaundryReceipt[]>([]);
  queueRef.current = queue;
  receiptsRef.current = receipts;

  const isProcessing =
    progress.phase !== 'idle' && progress.phase !== 'done' && progress.phase !== 'error';

  const operatorState: VoxelOperatorState = isProcessing
    ? progress.phase === 'spinning' || progress.phase === 'encoding'
      ? 'spinning'
      : 'washing'
    : activeScene === 'drying' && receipt
    ? 'drying'
    : 'idle';

  const activeAccent = CYCLE_ACCENT_MAP[cycle];

  useEffect(() => {
    syncWashPhaseLoop(progress.phase);
    if (prevPhaseRef.current !== 'done' && progress.phase === 'done') {
      playCycleCompleteChime();
    }
    prevPhaseRef.current = progress.phase;
  }, [progress.phase]);

  useEffect(() => {
    return () => {
      syncWashPhaseLoop('idle');
    };
  }, []);

  const handleToggleSfx = () => {
    const next = !sfxMuted;
    setSfxMutedState(next);
    setSfxMuted(next);
    if (!next) {
      playMechanicalClick(780);
      syncWashPhaseLoop(progress.phase);
    }
  };

  useEffect(() => {
    return () => {
      revokeMediaList(queueRef.current);
      revokeReceiptList(receiptsRef.current);
    };
  }, []);

  const handleLoadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    try {
      setErrorMsg(null);
      setReceipts((prev) => {
        revokeReceiptList(prev);
        return [];
      });
      setActiveReceiptIndex(0);
      setProgress(IDLE_PROGRESS);
      setActiveScene('washer');

      if (files.length === 1) {
        const loaded = await inspectLoadedFile(files[0]);
        playDoorLatch();
        setQueue((prev) => {
          revokeMediaList(prev);
          return [loaded];
        });
        setActiveQueueIndex(0);
        setCrop(DEFAULT_CROP);

        if (loaded.kind === 'video') {
          setCycle((cur) => (cur === 'clarify' ? 'both' : cur));
          const end = Math.max(0.5, Math.min(8, Number(loaded.durationSec.toFixed(1))));
          setTrim({ start: 0, end, fps: 12 });
          if (loaded.sizeMB > 0.4) {
            setTargetMB(Math.min(2.0, Number(Math.max(0.5, loaded.sizeMB * 0.6).toFixed(2))));
          }
        } else {
          setTargetMB(loaded.sizeMB < 0.3 ? 0.15 : 0.5);
        }
        return;
      }

      // Multi-file batch mode: keep image files, capped at MAX_BATCH_IMAGES
      const imageCandidates = files
        .filter((f) => f.type.startsWith('image/'))
        .slice(0, MAX_BATCH_IMAGES);
      if (imageCandidates.length === 0) {
        throw new Error('Batch mode supports images only (PNG, JPG, WebP, or static GIF).');
      }

      const loadedList = await Promise.all(imageCandidates.map((f) => inspectLoadedFile(f)));
      const staticImages = loadedList.filter((item) => item.kind === 'image');
      if (staticImages.length === 0) {
        revokeMediaList(loadedList);
        throw new Error('Batch mode supports static images only (animated GIF/video is single-load).');
      }
      if (staticImages.length < loadedList.length) {
        revokeMediaList(loadedList.filter((item) => item.kind !== 'image'));
      }

      playDoorLatch();
      setQueue((prev) => {
        revokeMediaList(prev);
        return staticImages;
      });
      setActiveQueueIndex(0);
      setCrop(DEFAULT_CROP);

      const avgMB =
        staticImages.reduce((acc, item) => acc + item.sizeMB, 0) / staticImages.length;
      setTargetMB(avgMB < 0.3 ? 0.15 : 0.5);

      if (files.length > MAX_BATCH_IMAGES) {
        setErrorMsg(`Batch capped at ${MAX_BATCH_IMAGES} images for browser memory safety.`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load file.');
    }
  };

  const handleLoadFile = async (file: File) => handleLoadFiles([file]);

  const handleRemoveQueueItem = (index: number) => {
    if (isProcessing) return;
    setQueue((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.objectUrl);
      const next = prev.filter((_, i) => i !== index);
      setActiveQueueIndex((cur) => Math.max(0, Math.min(cur, next.length - 1)));
      return next;
    });
  };

  const handleOutputEdited = (blob: Blob, width: number, height: number) => {
    const nextUrl = URL.createObjectURL(blob);
    const nextSizeMB = blob.size / (1024 * 1024);
    setReceipts((prev) =>
      prev.map((item, idx) => {
        if (idx !== activeReceiptIndex) return item;
        const savedPercent =
          item.originalSizeMB > 0
            ? Math.round(((item.originalSizeMB - nextSizeMB) / item.originalSizeMB) * 100)
            : 0;
        return {
          ...item,
          outputBlob: blob,
          outputUrl: nextUrl,
          finalSizeMB: nextSizeMB,
          savedPercent,
          width,
          height,
        };
      })
    );
  };

  // Ctrl/Cmd+V anywhere outside a text field drops the clipboard image straight into the drum.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (!item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;

        event.preventDefault();
        playDoorLatch();
        void handleLoadFile(file);
        return;
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
    // handleLoadFile only uses stable setters and module-level helpers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadSampleImage = async () => {
    try {
      setIsGeneratingSample(true);
      setErrorMsg(null);
      const sampleFile = await createSampleMemeImageFile();
      await handleLoadFile(sampleFile);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate sample image.');
    } finally {
      setIsGeneratingSample(false);
    }
  };

  const handleLoadSampleVideo = async () => {
    try {
      setIsGeneratingSample(true);
      setErrorMsg(null);
      const sampleVid = await createSampleMemeVideoFile();
      await handleLoadFile(sampleVid);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate sample video.');
    } finally {
      setIsGeneratingSample(false);
    }
  };

  const handleLoadSampleBlurryImage = async () => {
    try {
      setIsGeneratingSample(true);
      setErrorMsg(null);
      const blurryFile = await createSampleBlurryImageFile();
      await handleLoadFile(blurryFile);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to generate blurry sample image.'
      );
    } finally {
      setIsGeneratingSample(false);
    }
  };

  const handleClearMedia = () => {
    if (isProcessing) return;
    playDoorLatch();
    setQueue((prev) => {
      revokeMediaList(prev);
      return [];
    });
    setActiveQueueIndex(0);
    setReceipts((prev) => {
      revokeReceiptList(prev);
      return [];
    });
    setActiveReceiptIndex(0);
    setProgress(IDLE_PROGRESS);
    setErrorMsg(null);
    setActiveScene('washer');
  };

  const handleCycleDialClick = () => {
    playRotaryDialTick();
    const order: LaundryCycle[] =
      media?.kind === 'video' ? ['wash', 'spin', 'both'] : ['wash', 'spin', 'both', 'clarify'];
    setCycle((cur) => {
      const idx = order.indexOf(cur);
      return order[(idx === -1 ? 0 : idx + 1) % order.length];
    });
  };

  const handleStartCycle = async () => {
    if (queue.length === 0 || isProcessing) return;
    playDoorLatch();
    setErrorMsg(null);
    setReceipts((prev) => {
      revokeReceiptList(prev);
      return [];
    });
    setActiveReceiptIndex(0);

    try {
      if (queue.length === 1 && media) {
        const result =
          media.kind === 'image'
            ? await processImageLaundry({
                file: media.file,
                objectUrl: media.objectUrl,
                cycle,
                clarify,
                crop,
                targetMB,
                outputFormat: imageFormat,
                onProgress: setProgress,
              })
            : await processVideoLaundry({
                file: media.file,
                objectUrl: media.objectUrl,
                cycle,
                crop,
                trim,
                targetMB,
                outputFormat: videoFormat,
                onProgress: setProgress,
              });

        setReceipts([result]);
        setActiveReceiptIndex(0);
        setActiveScene('drying');
        return;
      }

      const batchResults: LaundryReceipt[] = [];
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        setActiveQueueIndex(i);
        const itemResult = await processImageLaundry({
          file: item.file,
          objectUrl: item.objectUrl,
          cycle,
          clarify,
          crop,
          targetMB,
          outputFormat: imageFormat,
          onProgress: (p) => {
            const overallPct = Math.min(
              100,
              Math.round(((i + p.percent / 100) / queue.length) * 100)
            );
            const isLast = i === queue.length - 1;
            setProgress({
              ...p,
              phase: p.phase === 'done' && !isLast ? 'washing' : p.phase,
              percent: overallPct,
              statusText: `BATCH ${i + 1}/${queue.length} // ${p.statusText}`,
            });
          },
        });
        batchResults.push(itemResult);
      }

      setReceipts(batchResults);
      setActiveReceiptIndex(0);
      setActiveScene('drying');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred while processing media.';
      setErrorMsg(msg);
      setProgress({
        phase: 'error',
        percent: 0,
        statusText: 'CYCLE ERROR',
      });
    }
  };

  return (
    <div
      data-shift={shift}
      style={
        {
          '--active-accent': activeAccent,
          backgroundColor: 'var(--ui-bg)',
          color: 'var(--ui-text)',
        } as React.CSSProperties
      }
      className="min-h-screen transition-colors duration-400 p-3 sm:p-5"
    >
      <div className="max-w-[1320px] mx-auto flex flex-col gap-4">
        {/* TOP SWISS NAVIGATION & SCENE SWITCHER */}
        <header className="neo-card px-4 py-2.5 flex flex-col lg:flex-row lg:flex-nowrap lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="px-2.5 py-1.5 font-mono text-xs font-bold tracking-widest uppercase shrink-0 whitespace-nowrap"
              style={{
                backgroundColor: '#111111',
                color: '#FFE600',
                border: '2px solid var(--ink)',
              }}
            >
              KILOWASH // 24H
            </span>
            <div className="min-w-0">
              <h1 className="font-extrabold text-sm sm:text-base tracking-tight uppercase leading-none text-adaptive truncate">
                DIGITAL DRY-CLEAN &amp; TARGET MB
              </h1>
              <div className="font-mono text-[10px] sm:text-[11px] mt-1 flex items-center gap-1.5 opacity-80 text-adaptive whitespace-nowrap">
                <ShieldCheck size={12} className="shrink-0" />
                <span>100% CLIENT-SIDE RMBG-1.4 AI • ZERO UPLOAD</span>
              </div>
            </div>
          </div>

          {/* Room Scene Switcher + Swiss Divider + SFX Icon + Day/Night Toggle + Creator Spotlight */}
          <div className="flex flex-wrap lg:flex-nowrap items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  playMechanicalClick(640);
                  setActiveScene('washer');
                }}
                className="neo-btn w-[114px] h-[38px] font-mono text-[11px] font-bold uppercase flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                style={{
                  backgroundColor:
                    activeScene === 'washer' ? 'var(--active-accent)' : 'var(--ui-subtle)',
                  color: activeScene === 'washer' ? '#111111' : 'var(--ui-text)',
                }}
              >
                <WashingMachine size={13} />
                01 WASHER
              </button>
              <button
                type="button"
                disabled={!receipt || isProcessing}
                onClick={() => {
                  if (!receipt) return;
                  playMechanicalClick(640);
                  setActiveScene('drying');
                }}
                className="neo-btn w-[114px] h-[38px] font-mono text-[11px] font-bold uppercase flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                style={{
                  backgroundColor:
                    activeScene === 'drying' ? 'var(--active-accent)' : 'var(--ui-subtle)',
                  color: activeScene === 'drying' ? '#111111' : 'var(--ui-text)',
                }}
              >
                <Wind size={13} />
                02 DRYING
              </button>
            </div>

            <span
              aria-hidden="true"
              className="hidden sm:block w-[2px] h-7 opacity-25 shrink-0"
              style={{ backgroundColor: 'var(--ui-text)' }}
            />

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleToggleSfx}
                aria-label={sfxMuted ? 'Unmute laundry SFX' : 'Mute laundry SFX'}
                title={sfxMuted ? 'SFX OFF — Click to enable sound' : 'SFX ON — Click to mute'}
                className="neo-btn w-[38px] h-[38px] flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: sfxMuted ? 'var(--ui-subtle)' : '#FFE600',
                  color: sfxMuted ? 'var(--ui-text)' : '#111111',
                }}
              >
                {sfxMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>

              <ThemeToggle
                shift={shift}
                onToggle={(next) => {
                  playMechanicalClick(720);
                  setShift(next);
                }}
              />

              <CreatorSpotlight
                operatorState={operatorState}
                cycle={cycle}
                shift={shift}
              />
            </div>
          </div>
        </header>

        {/* ERROR ALERT */}
        {errorMsg && (
          <div
            className="neo-card p-3.5 flex items-center justify-between gap-3"
            style={{ backgroundColor: '#FF5416', color: '#111111' }}
          >
            <div className="flex items-center gap-2 font-mono text-xs font-bold">
              <AlertTriangle size={16} />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="neo-btn px-2.5 py-1 font-mono text-[11px] font-bold bg-white text-black"
            >
              DISMISS
            </button>
          </div>
        )}

        {/* FULL-ROOM DIEGETIC 2.5D STAGE (SCENE 1: WASHER <-> SCENE 2: DRYING LINE) */}
        <div
          className="relative overflow-hidden"
          style={{
            border: '3px solid var(--ink)',
            boxShadow: '8px 8px 0 var(--shadow-color)',
          }}
        >
          <AnimatePresence mode="wait">
            {activeScene === 'washer' || !receipt ? (
              <motion.div
                key="washer-room"
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.35 }}
                className="flex flex-col justify-between"
              >
                <div className="swiss-wall relative pt-11 px-4 sm:px-7 pb-0 flex-1 flex flex-col justify-between">
                  {/* Overhead Industrial Pipe */}
                  <div
                    className="absolute top-3.5 left-0 right-0 h-4 flex items-center justify-around z-10"
                    style={{
                      backgroundColor: 'var(--pipe)',
                      borderTop: '3px solid var(--ink)',
                      borderBottom: '3px solid var(--ink)',
                    }}
                  >
                    {[0, 1, 2, 3, 4].map((idx) => (
                      <span
                        key={idx}
                        className="w-3.5 h-6"
                        style={{
                          backgroundColor: 'var(--panel)',
                          border: '3px solid var(--ink)',
                        }}
                      />
                    ))}
                  </div>

                  {/* Day Shift Diagonal Sunbeam */}
                  <div
                    className="absolute top-10 left-8 w-[480px] h-[480px] pointer-events-none z-10 transition-opacity duration-500"
                    style={{
                      opacity: shift === 'day' ? 1 : 0,
                      background:
                        'linear-gradient(130deg, rgba(255, 245, 190, 0.44) 0%, rgba(255, 245, 190, 0.12) 52%, rgba(255, 245, 190, 0) 80%)',
                      clipPath: 'polygon(0 12%, 44% 0, 100% 85%, 24% 100%)',
                    }}
                  />

                  {/* FULL-ROOM 3-COLUMN INTERIOR */}
                  <div className="relative z-20 grid grid-cols-1 lg:grid-cols-[240px_1fr_275px] gap-6 items-end pb-4 lg:pb-0">
                    {/* LEFT ROOM WALL & FLOOR: WINDOW + NEON SIGN + LAUNDRY BASKET */}
                    <div className="flex flex-row lg:flex-col flex-wrap justify-between gap-4 self-stretch pt-2 pb-2">
                      <div className="flex flex-col gap-3">
                        {/* Window */}
                        <div className="w-[220px]">
                          <div
                            className="w-full h-[165px] relative overflow-hidden transition-colors duration-500"
                            style={{
                              border: '4px solid var(--ink)',
                              boxShadow: '5px 5px 0 var(--shadow-color)',
                              background:
                                shift === 'night'
                                  ? 'linear-gradient(180deg, #0D1B2E 0%, #2B4360 100%)'
                                  : '#77CCF2',
                            }}
                          >
                            {/* Sun */}
                            <div
                              className="absolute top-3.5 right-4 w-9 h-9 rounded-full transition-all duration-500"
                              style={{
                                backgroundColor: '#FFD426',
                                border: '3px solid #111111',
                                opacity: shift === 'day' ? 1 : 0,
                                transform:
                                  shift === 'day'
                                    ? 'translateY(0)'
                                    : 'translateY(36px) scale(0.5)',
                              }}
                            />

                            {/* Crescent Moon */}
                            <svg
                              viewBox="0 0 40 40"
                              className="absolute top-3.5 right-4 w-9 h-9 transition-all duration-500"
                              style={{
                                opacity: shift === 'night' ? 1 : 0,
                                transform:
                                  shift === 'night' ? 'translateY(0)' : 'translateY(-28px)',
                              }}
                            >
                              <path
                                d="M27 29A12 12 0 0 1 15 9a12 12 0 1 0 16 17A11.9 11.9 0 0 1 27 29Z"
                                fill="#FFE600"
                                stroke="#111111"
                                strokeWidth="2"
                              />
                            </svg>

                            {/* Day Clouds */}
                            <div
                              className="transition-opacity duration-400"
                              style={{ opacity: shift === 'day' ? 1 : 0 }}
                            >
                              <div
                                className="absolute top-8 left-3 w-16 h-5 rounded-full bg-white animate-cloud-slow"
                                style={{ border: '2.5px solid #111111' }}
                              />
                              <div
                                className="absolute top-20 left-20 w-14 h-5 rounded-full bg-white animate-cloud-reverse"
                                style={{ border: '2.5px solid #111111' }}
                              />
                            </div>

                            {/* Night Stars */}
                            <div
                              className="absolute inset-0 transition-opacity duration-500"
                              style={{ opacity: shift === 'night' ? 1 : 0 }}
                            >
                              {[
                                { top: '18px', left: '22px', delay: '0s' },
                                { top: '38px', left: '68px', delay: '0.6s' },
                                { top: '70px', left: '28px', delay: '1.1s' },
                                { top: '26px', left: '115px', delay: '0.3s' },
                                { top: '82px', left: '150px', delay: '1.5s' },
                              ].map((st, idx) => (
                                <span
                                  key={idx}
                                  className="absolute w-1 h-1 rounded-full bg-[#FFF8C9] animate-twinkle"
                                  style={{
                                    top: st.top,
                                    left: st.left,
                                    animationDelay: st.delay,
                                  }}
                                />
                              ))}
                            </div>

                            <div
                              className="absolute left-1/2 top-0 bottom-0 w-1 -translate-x-1/2 z-10"
                              style={{ backgroundColor: 'var(--ink)' }}
                            />
                            <div
                              className="absolute top-1/2 left-0 right-0 h-1 -translate-y-1/2 z-10"
                              style={{ backgroundColor: 'var(--ink)' }}
                            />
                          </div>
                          <div
                            className="h-3.5 -mx-1.5 -mt-1 relative z-20"
                            style={{
                              backgroundColor: 'var(--machine-body)',
                              border: '3px solid var(--ink)',
                              boxShadow: '3px 3px 0 var(--shadow-color)',
                            }}
                          />
                        </div>

                        {/* Wall Neon Sign */}
                        <div
                          className="p-2.5 transition-all duration-400 w-[220px]"
                          style={{
                            backgroundColor: 'var(--sign-bg)',
                            color: 'var(--sign-text)',
                            border: '3px solid var(--sign-border)',
                            boxShadow:
                              shift === 'night'
                                ? '5px 5px 0 var(--shadow-color), 0 0 20px rgba(0, 229, 255, 0.45)'
                                : '5px 5px 0 var(--shadow-color)',
                          }}
                        >
                          <div className="font-mono text-[9px] tracking-[0.14em] uppercase opacity-80">
                            SELF-SERVICE MEDIA LAB
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="font-extrabold text-lg tracking-tight">
                              KILOWASH
                            </span>
                            <span
                              className="font-mono text-[10px] font-bold px-1.5 py-0.5"
                              style={{ border: '2px solid currentColor' }}
                            >
                              OPEN 24H
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Diegetic Dirty Laundry Basket */}
                      <div className="self-end lg:self-start lg:-mb-3">
                        <LaundryBasketFixture
                          media={media}
                          queue={queue}
                          activeQueueIndex={activeQueueIndex}
                          isProcessing={isProcessing}
                          isGeneratingSample={isGeneratingSample}
                          onFilesSelected={handleLoadFiles}
                          onSelectQueueItem={setActiveQueueIndex}
                          onRemoveQueueItem={handleRemoveQueueItem}
                          onLoadSampleImage={handleLoadSampleImage}
                          onLoadSampleVideo={handleLoadSampleVideo}
                          onLoadSampleBlurryImage={handleLoadSampleBlurryImage}
                        />
                      </div>
                    </div>

                    {/* CENTERPIECE: 2.5D LAUNDRY MACHINE WITH BUILT-IN START BUTTON */}
                    <div className="pb-0 lg:-mb-5 z-30">
                      <LaundryMachine
                        shift={shift}
                        media={media}
                        cycle={cycle}
                        clarify={clarify}
                        onCycleClick={handleCycleDialClick}
                        onStartCycle={handleStartCycle}
                        targetMB={targetMB}
                        imageFormat={imageFormat}
                        videoFormat={videoFormat}
                        crop={crop}
                        onChangeCrop={setCrop}
                        trim={trim}
                        onChangeTrim={setTrim}
                        progress={progress}
                        onFilesDropped={handleLoadFiles}
                        onClearMedia={handleClearMedia}
                      />
                    </div>

                    {/* RIGHT ROOM WALL: SWISS POSTER + DIEGETIC WALL DISPENSER & SCALE */}
                    <div className="flex flex-col gap-3 pb-4 self-start pt-2">
                      <div
                        className="p-2.5 neo-card"
                        style={{
                          backgroundColor: 'var(--ui-card)',
                          color: 'var(--ui-text)',
                        }}
                      >
                        <h2
                          className="font-extrabold text-[11px] uppercase pb-1 mb-1.5 text-adaptive"
                          style={{ borderBottom: '2px solid var(--ink)' }}
                        >
                          00 // LAUNDRY FLOW
                        </h2>
                        <p className="font-mono text-[10px] leading-snug text-adaptive opacity-90">
                          1. Load file → 2. Set pod &amp; MB → 3. Press{' '}
                          <strong
                            className="px-1 text-on-accent"
                            style={{ backgroundColor: 'var(--active-accent)' }}
                          >
                            START
                          </strong>{' '}
                          on machine → 4. Output hangs to dry!
                        </p>
                      </div>

                      <WallDispenserRackFixture
                        media={media}
                        cycle={cycle}
                        onChangeCycle={setCycle}
                        clarify={clarify}
                        onChangeClarify={setClarify}
                        targetMB={targetMB}
                        onChangeTargetMB={setTargetMB}
                        imageFormat={imageFormat}
                        onChangeImageFormat={setImageFormat}
                        videoFormat={videoFormat}
                        onChangeVideoFormat={setVideoFormat}
                        isProcessing={isProcessing}
                      />
                    </div>
                  </div>
                </div>

                {/* PERSPECTIVE TILED FLOOR WITH NEON REFLECTION */}
                <div
                  className="laundry-floor h-20 relative z-20"
                  style={{ borderTop: '4px solid var(--ink)' }}
                >
                  <div
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-[380px] h-12 pointer-events-none transition-opacity duration-500"
                    style={{
                      opacity: shift === 'night' ? 0.55 : 0.14,
                      background:
                        'radial-gradient(ellipse at top, var(--active-accent), transparent 72%)',
                    }}
                  />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="drying-room"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 30 }}
                transition={{ duration: 0.35 }}
              >
                <DryingLineScene
                  shift={shift}
                  receipt={receipt}
                  bulkReceipts={receipts}
                  activeReceiptIndex={activeReceiptIndex}
                  onSelectReceipt={setActiveReceiptIndex}
                  originalMedia={queue[activeReceiptIndex] ?? media}
                  crop={crop}
                  onOutputEdited={handleOutputEdited}
                  onBackToWasher={() => setActiveScene('washer')}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
