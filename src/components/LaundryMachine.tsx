import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, UploadCloud, X, Loader2 } from 'lucide-react';
import type {
  ClarifyOptions,
  CropBox,
  ImageOutputFormat,
  LaundryCycle,
  LoadedMedia,
  ThemeShift,
  VideoOutputFormat,
  VideoTrim,
  WashProgress,
} from '../types/laundry';
import { PreTreatBar, PreTreatCropOverlay } from './PreTreatOverlay';

interface LaundryMachineProps {
  shift: ThemeShift;
  media: LoadedMedia | null;
  cycle: LaundryCycle;
  clarify: ClarifyOptions;
  onCycleClick: () => void;
  onStartCycle: () => void;
  targetMB: number;
  imageFormat: ImageOutputFormat;
  videoFormat: VideoOutputFormat;
  crop: CropBox;
  onChangeCrop: (c: CropBox) => void;
  trim: VideoTrim;
  onChangeTrim: (t: VideoTrim) => void;
  progress: WashProgress;
  onFileDropped: (file: File) => void;
  onClearMedia: () => void;
}

export const LaundryMachine: React.FC<LaundryMachineProps> = ({
  shift,
  media,
  cycle,
  clarify,
  onCycleClick,
  onStartCycle,
  targetMB,
  imageFormat,
  videoFormat,
  crop,
  onChangeCrop,
  trim,
  onChangeTrim,
  progress,
  onFileDropped,
  onClearMedia,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isProcessing =
    progress.phase !== 'idle' && progress.phase !== 'done' && progress.phase !== 'error';

  const isFilling = progress.phase === 'filling';
  const isWashing =
    progress.phase === 'washing' ||
    progress.phase === 'clarifying' ||
    progress.phase === 'loading-model' ||
    progress.phase === 'extracting';
  const isRinsing = progress.phase === 'rinsing';
  const isSpinPhase =
    isProcessing && (progress.phase === 'spinning' || progress.phase === 'encoding');
  const isFastCentrifuge =
    isSpinPhase &&
    (cycle === 'spin' || cycle === 'both' || (cycle === 'clarify' && clarify.withSpin));

  const dialAngles: Record<LaundryCycle, number> = {
    wash: -52,
    spin: -18,
    both: 18,
    clarify: 52,
  };

  const activeFormat =
    media?.kind === 'video' ? videoFormat.toUpperCase() : imageFormat.toUpperCase();
  const idleReadout = !media
    ? `IDLE // LOAD MEDIA (${cycle.toUpperCase()})`
    : cycle === 'wash'
    ? `WASH // RMBG-1.4 AI (${activeFormat})`
    : cycle === 'clarify'
    ? `CLARIFY // ${clarify.mode === 'ai' ? 'AI 4X' : clarify.mode.toUpperCase()}${
        clarify.withWash ? '+BG' : ''
      }${clarify.withSpin ? ` <= ${targetMB.toFixed(2)}MB` : ` (${activeFormat})`}`
    : `TARGET: ${targetMB.toFixed(2)} MB | ${activeFormat}`;

  const doorOpenAngle =
    !isProcessing && (isDragOver || (!media && isHovered)) ? -26 : 0;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (isProcessing) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      onFileDropped(dropped);
    }
  };

  // Water wave height & opacity based on stage
  const liquidHeight = !isProcessing
    ? media
      ? '14%'
      : '22%'
    : isFilling
    ? '48%'
    : isWashing
    ? '64%'
    : isRinsing
    ? '36%'
    : isFastCentrifuge
    ? '20%'
    : '26%';

  const liquidOpacity = !isProcessing ? (media ? 0.22 : 0.42) : isRinsing ? 0.52 : 0.8;

  return (
    <motion.div
      animate={
        isFastCentrifuge
          ? {
              x: [-2.8, 2.8, -2.2, 2.2, 0],
              y: [1.5, -1.8, 1.2, -2, 0],
            }
          : isWashing
          ? {
              x: [-1.2, 1.2, -1, 1, 0],
              y: [0.6, -0.6, 0],
            }
          : { x: 0, y: 0 }
      }
      transition={
        isProcessing
          ? { duration: isFastCentrifuge ? 0.12 : 0.32, repeat: Infinity }
          : { duration: 0.2 }
      }
      className="relative w-full max-w-[490px] mx-auto"
    >
      {/* 2.5D Top Extrude */}
      <div className="machine-top-extrude" />

      <div className="flex items-stretch">
        {/* Main Front Chassis */}
        <div
          className="flex-1 p-4 sm:p-5 relative transition-colors duration-300"
          style={{
            backgroundColor: 'var(--machine-body)',
            color: 'var(--ui-text)',
            border: '4px solid var(--ink)',
            boxShadow: '8px 10px 0 var(--shadow-color)',
            outline: '1px solid var(--night-rim)',
            outlineOffset: '-5px',
          }}
        >
          {/* Swiss Control Header WITH Built-in START WASH Button */}
          <div
            className="p-3 mb-4 flex flex-col gap-2.5"
            style={{
              backgroundColor: 'var(--panel)',
              color: 'var(--panel-text)',
              border: '3px solid var(--ink)',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-bold tracking-wider uppercase truncate">
                MODEL KW-01 // FRONT-LOAD WASH &amp; MB SPIN
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                {[
                  { id: 'wash' as const, color: 'var(--wash-accent)' },
                  { id: 'spin' as const, color: 'var(--spin-accent)' },
                  { id: 'both' as const, color: 'var(--both-accent)' },
                  { id: 'clarify' as const, color: 'var(--clarify-accent)' },
                ].map((lamp) => {
                  const isOn = cycle === lamp.id;
                  return (
                    <span
                      key={lamp.id}
                      className="w-2.5 h-2.5 rounded-full border-2"
                      style={{
                        borderColor: '#111111',
                        backgroundColor: isOn ? lamp.color : '#475569',
                        boxShadow: isOn ? `0 0 8px ${lamp.color}` : 'none',
                      }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto_auto] gap-2.5 items-center">
              {/* LED Digital Readout */}
              <div
                className="px-2.5 py-2 font-mono text-[11px] font-bold flex items-center justify-between gap-2 min-w-0"
                style={{
                  backgroundColor: '#0B1014',
                  color: 'var(--active-accent)',
                  border: '2.5px solid var(--ink)',
                  boxShadow:
                    shift === 'night'
                      ? 'inset 0 0 12px rgba(0,0,0,0.8), 0 0 14px var(--active-accent)'
                      : 'inset 0 0 10px rgba(0,0,0,0.7)',
                }}
              >
                <span className="truncate">
                  {isProcessing ? progress.statusText : idleReadout}
                </span>
                <span className="shrink-0">
                  {isProcessing ? `${progress.percent}%` : media ? 'READY' : 'WAIT'}
                </span>
              </div>

              {/* Rotary Program Dial */}
              <button
                type="button"
                disabled={isProcessing}
                onClick={onCycleClick}
                title="Click to rotate program: Wash / Spin / Both / Clarify"
                className="w-10 h-10 rounded-full relative cursor-pointer disabled:cursor-not-allowed shrink-0"
                style={{
                  backgroundColor: 'var(--ui-card)',
                  border: '3px solid var(--ink)',
                  boxShadow: '2px 2px 0 var(--shadow-color)',
                  transform: `rotate(${dialAngles[cycle]}deg)`,
                  transition: 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
                }}
              >
                <span
                  className="absolute top-1 left-1/2 -translate-x-1/2 w-1 h-3"
                  style={{
                    backgroundColor: 'var(--active-accent)',
                    border: '1px solid #111111',
                  }}
                />
              </button>

              {/* Built-in Physical START Button on the Washing Machine */}
              <motion.button
                type="button"
                disabled={!media || isProcessing}
                onClick={onStartCycle}
                whileTap={!media || isProcessing ? undefined : { scale: 0.94 }}
                className="neo-btn px-3 py-2 font-extrabold text-xs uppercase tracking-wide flex items-center gap-1.5 shrink-0"
                style={{
                  backgroundColor: !media
                    ? 'var(--ui-subtle)'
                    : isProcessing
                    ? '#111111'
                    : 'var(--active-accent)',
                  color: !media
                    ? 'var(--ui-muted)'
                    : isProcessing
                    ? 'var(--active-accent)'
                    : '#111111',
                }}
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>WASHING</span>
                  </>
                ) : (
                  <>
                    <Play size={14} fill="currentColor" />
                    <span>START</span>
                  </>
                )}
              </motion.button>
            </div>
          </div>

          {/* Circular Glass Drum Housing */}
          <div className="flex justify-center items-center py-1">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!isProcessing) setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              className="relative flex items-center justify-center rounded-full"
              style={{
                width: '290px',
                height: '290px',
                backgroundColor: 'var(--panel)',
                border: '4px solid var(--ink)',
                boxShadow:
                  shift === 'night'
                    ? '6px 6px 0 var(--shadow-color), 0 0 28px color-mix(in srgb, var(--active-accent) 45%, transparent)'
                    : '6px 6px 0 var(--shadow-color)',
                perspective: '900px',
              }}
            >
              {/* Door Hinge & Latch */}
              <div
                className="absolute -left-2.5 w-3.5 h-12 rounded-sm z-20"
                style={{ backgroundColor: 'var(--ink)' }}
              />
              <div
                className="absolute -right-3 w-4 h-14 rounded-sm z-20 transition-colors"
                style={{
                  backgroundColor: 'var(--active-accent)',
                  border: '3px solid var(--ink)',
                }}
              />

              {/* Clear button when media loaded & idle */}
              {media && !isProcessing && (
                <button
                  type="button"
                  onClick={onClearMedia}
                  title="Eject media from drum"
                  className="neo-btn absolute -top-2 -right-2 z-30 w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#FF5416', color: '#111111' }}
                >
                  <X size={15} strokeWidth={3} />
                </button>
              )}

              {/* Drum Door (Hinges on left when dragging or hovering empty drum) */}
              <motion.div
                animate={{ rotateY: doorOpenAngle }}
                transition={{ type: 'spring', stiffness: 220, damping: 20 }}
                style={{
                  transformOrigin: 'left center',
                  width: '238px',
                  height: '238px',
                  border: '4px solid var(--ink)',
                }}
                className="rounded-full relative overflow-hidden checkerboard-bg flex items-center justify-center"
              >
                {/* Water Intake Stream from top nozzle during Filling */}
                {isFilling && (
                  <motion.div
                    initial={{ scaleY: 0, opacity: 0 }}
                    animate={{ scaleY: [0.7, 1, 0.85], opacity: 0.85 }}
                    transition={{ duration: 0.35, repeat: Infinity }}
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-32 z-20 origin-top rounded-b-full"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.95) 0%, var(--active-accent) 100%)',
                      borderLeft: '2px solid var(--ink)',
                      borderRight: '2px solid var(--ink)',
                    }}
                  />
                )}

                {/* Empty Dropzone Prompt */}
                {!media && (
                  <div className="flex flex-col items-center justify-center text-center px-5 z-10">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center mb-2.5"
                      style={{
                        backgroundColor: 'var(--active-accent)',
                        border: '3px solid var(--ink)',
                        color: '#111111',
                      }}
                    >
                      <UploadCloud size={22} />
                    </div>
                    <p
                      className="font-bold text-xs uppercase px-2 py-1"
                      style={{
                        backgroundColor: 'var(--ui-card)',
                        border: '2px solid var(--ink)',
                        color: 'var(--ui-text)',
                      }}
                    >
                      {isDragOver ? 'RELEASE TO LOAD DRUM!' : 'DROP FILE INTO DRUM'}
                    </p>
                    <span
                      className="font-mono text-[10px] font-bold mt-1.5 px-2 py-0.5"
                      style={{
                        backgroundColor: '#111111',
                        color: '#FFFDF8',
                      }}
                    >
                      OR PICK FROM LAUNDRY BASKET
                    </span>
                  </div>
                )}

                {/* Media Preview + Focus Crop Overlay (Before Wash) */}
                {media && !isProcessing && (
                  <div className="relative w-full h-full flex items-center justify-center bg-black/10">
                    {media.kind === 'image' ? (
                      <img
                        src={media.objectUrl}
                        alt={media.file.name}
                        className="w-full h-full object-contain pointer-events-none"
                      />
                    ) : (
                      <video
                        src={media.objectUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="w-full h-full object-contain pointer-events-none"
                      />
                    )}
                    <PreTreatCropOverlay
                      crop={crop}
                      onChangeCrop={onChangeCrop}
                      disabled={isProcessing}
                    />
                  </div>
                )}

                {/* Live Washing / Scrubbing / Rinsing / Spinning Preview */}
                {isProcessing && (
                  <motion.div
                    animate={
                      isFastCentrifuge
                        ? { rotate: 360, scale: 0.88 }
                        : isWashing
                        ? {
                            rotate: [0, -32, 36, -28, 24, 0],
                            y: [0, -7, 4, -5, 0],
                            scale: [0.96, 1.02, 0.96],
                          }
                        : isRinsing
                        ? { rotate: [0, 12, -10, 0], scale: 1 }
                        : { y: [0, -3, 0], scale: 0.98 }
                    }
                    transition={
                      isFastCentrifuge
                        ? { duration: 0.34, repeat: Infinity, ease: 'linear' }
                        : isWashing
                        ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
                        : { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }
                    }
                    className="w-40 h-40 flex items-center justify-center z-10 relative"
                  >
                    {progress.previewDataUrl ? (
                      <img
                        src={progress.previewDataUrl}
                        alt="Live drum preview"
                        className="w-full h-full object-contain drop-shadow"
                      />
                    ) : media?.kind === 'image' ? (
                      <img
                        src={media.objectUrl}
                        alt="Washing"
                        className="w-full h-full object-contain"
                      />
                    ) : media ? (
                      <video
                        src={media.objectUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="w-full h-full object-contain"
                      />
                    ) : null}
                  </motion.div>
                )}

                {/* AI Laser Scan Bar during Scrubbing */}
                {isWashing && (
                  <div
                    className="absolute left-3 right-3 h-1 z-30 animate-scan-beam pointer-events-none"
                    style={{
                      backgroundColor: '#00E5FF',
                      boxShadow: '0 0 12px #00E5FF, 0 0 20px #00E5FF',
                    }}
                  />
                )}

                {/* Flying Water Droplets during High-Speed Centrifuge */}
                {isFastCentrifuge && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.45, repeat: Infinity, ease: 'linear' }}
                    className="absolute inset-0 pointer-events-none z-30"
                  >
                    {[0, 60, 120, 180, 240, 300].map((deg) => (
                      <span
                        key={deg}
                        className="absolute top-3 left-1/2 w-2 h-2 rounded-full"
                        style={{
                          backgroundColor: '#FFFFFF',
                          border: '1.5px solid #111111',
                          transformOrigin: '0 107px',
                          transform: `rotate(${deg}deg)`,
                        }}
                      />
                    ))}
                  </motion.div>
                )}

                {/* Rotating / Agitating Drum Ribs */}
                <motion.div
                  animate={
                    isFastCentrifuge
                      ? { rotate: 360 }
                      : isWashing
                      ? { rotate: [0, -45, 50, -35, 30, 0] }
                      : isProcessing
                      ? { rotate: 360 }
                      : { rotate: 0 }
                  }
                  transition={
                    isFastCentrifuge
                      ? { duration: 0.34, repeat: Infinity, ease: 'linear' }
                      : isWashing
                      ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
                      : isProcessing
                      ? { duration: 1.25, repeat: Infinity, ease: 'linear' }
                      : { duration: 0.3 }
                  }
                  className="absolute -inset-3 rounded-full pointer-events-none z-20"
                >
                  {[0, 120, 240].map((deg) => (
                    <div
                      key={deg}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: 0,
                        width: '14px',
                        height: '34px',
                        marginLeft: '-7px',
                        backgroundColor: 'rgba(17, 17, 17, 0.32)',
                        border: '2px solid var(--ink)',
                        borderRadius: '4px',
                        transformOrigin: '7px 131px',
                        transform: `rotate(${deg}deg)`,
                      }}
                    />
                  ))}
                </motion.div>

                {/* Detergent Liquid Wave + Dense Foam Bubbles */}
                <div
                  className="absolute -left-[20%] -right-[20%] -bottom-2 pointer-events-none z-20 transition-all duration-500"
                  style={{
                    height: liquidHeight,
                    opacity: liquidOpacity,
                  }}
                >
                  <svg
                    className="w-[200%] h-full animate-wave-slide"
                    viewBox="0 0 400 120"
                    preserveAspectRatio="none"
                  >
                    <path
                      d="M0,26 Q50,6 100,26 T200,26 T300,26 T400,26 L400,120 L0,120 Z"
                      fill="var(--active-accent)"
                    />
                  </svg>

                  {isProcessing && (
                    <>
                      {[
                        { size: 15, left: '24%', bottom: '18px', delay: '0s' },
                        { size: 11, left: '38%', bottom: '28px', delay: '0.4s' },
                        { size: 16, left: '52%', bottom: '16px', delay: '0.7s' },
                        { size: 12, left: '64%', bottom: '26px', delay: '1.0s' },
                        { size: 14, left: '74%', bottom: '20px', delay: '1.3s' },
                        { size: 9, left: '46%', bottom: '14px', delay: '1.5s' },
                      ].map((b, idx) => (
                        <div
                          key={idx}
                          className="absolute rounded-full bg-white/90 border-2 animate-bubble"
                          style={{
                            width: `${b.size}px`,
                            height: `${b.size}px`,
                            left: b.left,
                            bottom: b.bottom,
                            animationDelay: b.delay,
                            borderColor: '#111111',
                          }}
                        />
                      ))}
                    </>
                  )}
                </div>

                {/* Glass Glare */}
                <div
                  className="absolute inset-0 pointer-events-none z-30"
                  style={{
                    background:
                      'linear-gradient(125deg, rgba(255,255,255,0.36) 0%, rgba(255,255,255,0) 44%)',
                  }}
                />
              </motion.div>
            </div>
          </div>

          {/* Progress Bar while running */}
          {isProcessing && (
            <div className="mt-3">
              <div
                className="w-full h-5 border-2 relative overflow-hidden"
                style={{ borderColor: 'var(--ink)', backgroundColor: '#0B1014' }}
              >
                <div
                  className="h-full transition-all duration-200"
                  style={{
                    width: `${progress.percent}%`,
                    backgroundColor: 'var(--active-accent)',
                  }}
                />
                <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold text-white mix-blend-difference">
                  {progress.currentFrame && progress.totalFrames
                    ? `FRAME ${progress.currentFrame}/${progress.totalFrames} (${progress.percent}%)`
                    : `${progress.percent}% — ${progress.statusText}`}
                </span>
              </div>
            </div>
          )}

          {/* Pre-Treat Focus Crop & Video Trim Bar */}
          {media && !isProcessing && (
            <PreTreatBar
              mediaKind={media.kind}
              durationSec={media.durationSec}
              crop={crop}
              onChangeCrop={onChangeCrop}
              trim={trim}
              onChangeTrim={onChangeTrim}
              disabled={isProcessing}
            />
          )}

          {/* Machine Footer Plate & Quick Action */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <span
              className="font-mono text-[10px] font-bold px-2 py-1 border-2"
              style={{
                borderColor: 'var(--ink)',
                backgroundColor: 'var(--ui-card)',
                color: 'var(--ui-text)',
              }}
            >
              RMBG-1.4 AI // MAX 8s VIDEO
            </span>
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((v) => (
                <span
                  key={v}
                  className="w-1.5 h-4"
                  style={{ backgroundColor: 'var(--ink)' }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* 2.5D Right Side Extrusion */}
        <div className="machine-side-depth hidden sm:block" />
      </div>
    </motion.div>
  );
};
