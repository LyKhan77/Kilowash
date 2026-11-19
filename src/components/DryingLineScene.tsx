import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ClipboardCheck,
  Copy,
  Download,
  RotateCcw,
  Eye,
  Sparkles,
  Sticker,
  Wind,
} from 'lucide-react';
import {
  DEFAULT_HANGER_STUDIO,
  hasActiveHangerFx,
  renderHangerStudioImage,
  type ExportBackdropMode,
  type HangerStudioOptions,
  type StickerThickness,
} from '../services/hangerStudio';
import { playMechanicalClick } from '../utils/laundrySfx';
import { TouchUpCanvas, TouchUpShelf, useTouchUpBrush } from './TouchUpBrush';
import type {
  CropBox,
  ImageOutputFormat,
  LaundryReceipt,
  LoadedMedia,
  ThemeShift,
} from '../types/laundry';

interface DryingLineSceneProps {
  shift: ThemeShift;
  receipt: LaundryReceipt;
  originalMedia: LoadedMedia | null;
  crop: CropBox;
  onOutputEdited: (blob: Blob, width: number, height: number) => void;
  onBackToWasher: () => void;
}

type BackdropCloth = 'checker' | 'greenscreen' | 'dark' | 'white';

/**
 * Scene 2: Drying Line Area inside the 2.5D Laundromat Room.
 * Hangs the processed output on a clothesline with clothespins, breeze sway,
 * drying droplets, hanging care tag receipt, and folding table controls.
 */
export const DryingLineScene: React.FC<DryingLineSceneProps> = ({
  shift,
  receipt,
  originalMedia,
  crop,
  onOutputEdited,
  onBackToWasher,
}) => {
  const [backdrop, setBackdrop] = useState<BackdropCloth>('checker');
  const [showBefore, setShowBefore] = useState(false);
  const [compareSplit, setCompareSplit] = useState(50);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [compareZoom, setCompareZoom] = useState<1 | 2 | 4>(1);
  const [compareFocus, setCompareFocus] = useState<'50% 50%' | '28% 28%' | '50% 82%'>('50% 50%');
  const [hangerFx, setHangerFx] = useState<HangerStudioOptions>(DEFAULT_HANGER_STUDIO);
  const [isApplyingFx, setIsApplyingFx] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');

  const baseBlobRef = useRef<Blob>(receipt.outputBlob);
  const baseUrlRef = useRef<string>(receipt.outputUrl);
  const baseDimsRef = useRef<{ width: number; height: number }>({
    width: receipt.width,
    height: receipt.height,
  });
  const lastFxBlobRef = useRef<Blob | null>(null);
  const fxSeqRef = useRef(0);

  const hangerFxRef = useRef<HangerStudioOptions>(DEFAULT_HANGER_STUDIO);

  useEffect(() => {
    if (receipt.outputBlob !== lastFxBlobRef.current) {
      baseBlobRef.current = receipt.outputBlob;
      baseUrlRef.current = receipt.outputUrl;
      baseDimsRef.current = { width: receipt.width, height: receipt.height };
      hangerFxRef.current = DEFAULT_HANGER_STUDIO;
      setHangerFx(DEFAULT_HANGER_STUDIO);
    }
  }, [receipt.outputBlob, receipt.outputUrl, receipt.width, receipt.height]);

  const applyHangerStudio = async (
    updater: HangerStudioOptions | ((prev: HangerStudioOptions) => HangerStudioOptions)
  ) => {
    const nextFx = typeof updater === 'function' ? updater(hangerFxRef.current) : updater;
    hangerFxRef.current = nextFx;
    setHangerFx(nextFx);
    if (receipt.mediaKind !== 'image') return;

    const seq = ++fxSeqRef.current;
    if (!hasActiveHangerFx(nextFx)) {
      lastFxBlobRef.current = baseBlobRef.current;
      setIsApplyingFx(false);
      onOutputEdited(
        baseBlobRef.current,
        baseDimsRef.current.width,
        baseDimsRef.current.height
      );
      return;
    }

    setIsApplyingFx(true);
    try {
      const rendered = await renderHangerStudioImage({
        baseUrl: baseUrlRef.current,
        options: nextFx,
        format: touchUpFormat,
        enforceTargetMB: receipt.enforcedTargetMB,
        targetMB: receipt.targetMB,
      });
      if (seq !== fxSeqRef.current) return;
      lastFxBlobRef.current = rendered.blob;
      onOutputEdited(rendered.blob, rendered.width, rendered.height);
    } finally {
      if (seq === fxSeqRef.current) {
        setIsApplyingFx(false);
      }
    }
  };

  const touchUpFormat: ImageOutputFormat =
    receipt.fileExtension === 'png'
      ? 'png'
      : receipt.fileExtension === 'jpg'
      ? 'jpeg'
      : 'webp';

  const brush = useTouchUpBrush({
    editable: receipt.mediaKind === 'image' && !showBefore,
    outputUrl: receipt.outputUrl,
    outputWidth: receipt.width,
    outputHeight: receipt.height,
    originalUrl: originalMedia?.kind === 'image' ? originalMedia.objectUrl : null,
    crop,
    format: touchUpFormat,
    enforceTargetMB: receipt.enforcedTargetMB,
    targetMB: receipt.targetMB,
    onCommit: onOutputEdited,
  });

  const handleDownload = () => {
    playMechanicalClick(820);
    const baseName = receipt.fileName.replace(/\.[^/.]+$/, '');
    const a = document.createElement('a');
    a.href = receipt.outputUrl;
    a.download = `kilowash-${baseName}.${receipt.fileExtension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const copyPngToClipboard = async () => {
    playMechanicalClick(880);
    try {
      let pngBlob = receipt.outputBlob;

      if (pngBlob.type !== 'image/png') {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Failed to decode the output for clipboard export.'));
          el.src = receipt.outputUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context is unavailable.');
        ctx.drawImage(img, 0, 0);
        pngBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))),
            'image/png'
          );
        });
      }

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      setCopyState('ok');
    } catch {
      setCopyState('fail');
    }
    window.setTimeout(() => setCopyState('idle'), 2400);
  };

  const previewBgClass = backdrop === 'checker' ? 'checkerboard-bg' : '';
  const previewBgStyle: React.CSSProperties =
    backdrop === 'greenscreen'
      ? { backgroundColor: '#00FF00' }
      : backdrop === 'dark'
      ? { backgroundColor: '#0F172A' }
      : backdrop === 'white'
      ? { backgroundColor: '#FFFFFF' }
      : {};

  const activeUrl =
    showBefore && originalMedia ? originalMedia.objectUrl : receipt.outputUrl;
  const renderAsVideo =
    (showBefore && originalMedia?.kind === 'video') ||
    (!showBefore && receipt.fileExtension === 'webm');

  const canCompareSplit = Boolean(
    receipt.beforeUrl &&
      receipt.clarifyBackend &&
      !brush.armed &&
      !showBefore &&
      !renderAsVideo
  );

  const metTarget =
    !receipt.enforcedTargetMB || receipt.finalSizeMB <= receipt.targetMB + 0.01;

  return (
    <div className="relative flex flex-col justify-between min-h-[560px]">
      <div className="swiss-wall relative pt-10 px-4 sm:px-8 pb-6 flex-1 flex flex-col justify-between overflow-hidden">
        {/* Overhead String Bulbs (Night glow / Day industrial lamp cord) */}
        <div
          className="absolute top-3 left-0 right-0 h-3 flex items-center justify-around z-10"
          style={{
            backgroundColor: 'var(--pipe)',
            borderTop: '3px solid var(--ink)',
            borderBottom: '3px solid var(--ink)',
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((b) => (
            <div key={b} className="relative top-3 flex flex-col items-center">
              <span
                className="w-1 h-2"
                style={{ backgroundColor: 'var(--ink)' }}
              />
              <span
                className="w-4 h-4 rounded-full border-2 transition-all duration-500"
                style={{
                  borderColor: 'var(--ink)',
                  backgroundColor: shift === 'night' ? '#FFE600' : '#E2E8F0',
                  boxShadow:
                    shift === 'night'
                      ? '0 0 18px #FFE600, 0 0 34px rgba(255, 230, 0, 0.55)'
                      : 'none',
                }}
              />
            </div>
          ))}
        </div>

        {/* Day Breeze Sunbeam */}
        <div
          className="absolute top-8 right-12 w-[420px] h-[420px] pointer-events-none z-10 transition-opacity duration-500"
          style={{
            opacity: shift === 'day' ? 1 : 0,
            background:
              'linear-gradient(225deg, rgba(255, 245, 190, 0.42) 0%, rgba(255, 245, 190, 0) 75%)',
            clipPath: 'polygon(56% 0, 100% 14%, 72% 100%, 0 82%)',
          }}
        />

        {/* Room Top Signage */}
        <div className="relative z-20 flex flex-wrap items-center justify-between gap-3 mt-4 mb-4">
          <div
            className="px-3 py-1.5 flex items-center gap-2"
            style={{
              backgroundColor: 'var(--sign-bg)',
              color: 'var(--sign-text)',
              border: '3px solid var(--sign-border)',
              boxShadow:
                shift === 'night'
                  ? '4px 4px 0 var(--shadow-color), 0 0 18px rgba(0, 229, 255, 0.45)'
                  : '4px 4px 0 var(--shadow-color)',
            }}
          >
            <Wind size={15} />
            <span className="font-mono text-xs font-bold uppercase tracking-wider">
              SCENE 02 // DRYING LINE (OUTPUT HANGING)
            </span>
          </div>

          <span
            className="font-mono text-xs font-bold px-3 py-1.5 border-2 flex items-center gap-1.5"
            style={{
              borderColor: 'var(--ink)',
              backgroundColor: 'var(--active-accent)',
              color: '#111111',
            }}
          >
            <Sparkles size={14} />
            BREEZE DRYING ACTIVE
          </span>
        </div>

        {/* CLOTHESLINE AREA */}
        <div className="relative z-20 my-2">
          {/* Wall Anchor Brackets + Horizontal Clothesline Wire */}
          <div className="relative flex items-center justify-between">
            <div
              className="w-5 h-7 z-20 shrink-0"
              style={{
                backgroundColor: 'var(--panel)',
                border: '3px solid var(--ink)',
              }}
            />
            <div
              className="flex-1 h-1.5 -mx-1"
              style={{
                backgroundColor: 'var(--ink)',
                boxShadow:
                  shift === 'night' ? '0 0 8px rgba(255, 255, 255, 0.25)' : 'none',
              }}
            />
            <div
              className="w-5 h-7 z-20 shrink-0"
              style={{
                backgroundColor: 'var(--panel)',
                border: '3px solid var(--ink)',
              }}
            />
          </div>

          {/* Hanging Output & Hanging Receipt Tag */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.95fr] gap-6 items-start px-2 sm:px-6 -mt-1.5">
            {/* LEFT: SWAYING HANGING GARMENT (THE PROCESSED OUTPUT) */}
            <div className="flex w-full flex-col items-center">
            <motion.div
              animate={brush.armed ? { rotate: 0 } : { rotate: [-1.2, 1.3, -1.2] }}
              transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
              style={{ transformOrigin: 'top center' }}
              className="relative flex flex-col items-center w-full"
            >
              {/* Two Clothespins */}
              <div className="w-full max-w-[380px] flex justify-between px-10 relative z-30 -mb-3">
                {[
                  { color: '#FF5416', rot: '-6deg' },
                  { color: '#FFE600', rot: '6deg' },
                ].map((pin, idx) => (
                  <div
                    key={idx}
                    className="w-5 h-11 rounded-sm flex flex-col items-center justify-between py-1"
                    style={{
                      backgroundColor: pin.color,
                      border: '2.5px solid var(--ink)',
                      boxShadow: '2px 2px 0 var(--shadow-color)',
                      transform: `rotate(${pin.rot})`,
                    }}
                  >
                    <span className="w-2.5 h-1 bg-black/50" />
                    <span className="w-3 h-0.5 bg-black" />
                  </div>
                ))}
              </div>

              {/* Hanging Canvas Sheet */}
              <div
                className={`w-full max-w-[420px] h-[300px] relative flex items-center justify-center overflow-hidden ${previewBgClass}`}
                style={{
                  border: '4px solid var(--ink)',
                  boxShadow:
                    shift === 'night'
                      ? '8px 10px 0 var(--shadow-color), 0 0 24px color-mix(in srgb, var(--active-accent) 30%, transparent)'
                      : '8px 10px 0 var(--shadow-color)',
                  ...previewBgStyle,
                }}
              >
                <span
                  className="absolute top-2.5 left-2.5 z-20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase"
                  style={{
                    backgroundColor: '#111111',
                    color: showBefore ? '#FFE600' : brush.armed ? '#FF5416' : '#00E5FF',
                    border: '1.5px solid #00E5FF',
                  }}
                >
                  {showBefore
                    ? 'BEFORE // ORIGINAL'
                    : brush.armed
                    ? `TOUCH-UP // ${brush.tool === 'erase' ? 'BLEACH' : 'FABRIC PATCH'}`
                    : `CLEAN OUTPUT // ${receipt.formatLabel}`}
                </span>

                {brush.armed ? (
                  <TouchUpCanvas api={brush} />
                ) : renderAsVideo ? (
                  <video
                    key={activeUrl}
                    src={activeUrl}
                    controls
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="max-w-full max-h-full object-contain p-3"
                  />
                ) : canCompareSplit && receipt.beforeUrl ? (
                  <div
                    role="slider"
                    aria-label="Before and after clarify comparison"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(compareSplit)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft') setCompareSplit((s) => Math.max(0, s - 5));
                      if (e.key === 'ArrowRight') setCompareSplit((s) => Math.min(100, s + 5));
                    }}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDraggingSplit(true);
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = ((e.clientX - rect.left) / rect.width) * 100;
                      setCompareSplit(Math.max(0, Math.min(100, pct)));
                    }}
                    onPointerMove={(e) => {
                      if (!draggingSplit) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = ((e.clientX - rect.left) / rect.width) * 100;
                      setCompareSplit(Math.max(0, Math.min(100, pct)));
                    }}
                    onPointerUp={() => setDraggingSplit(false)}
                    onPointerCancel={() => setDraggingSplit(false)}
                    className="relative w-full h-full select-none cursor-ew-resize touch-none"
                  >
                    <img
                      src={receipt.outputUrl}
                      alt="After Clarify output"
                      draggable={false}
                      className="absolute inset-0 w-full h-full object-contain p-3 pointer-events-none transition-transform duration-200"
                      style={{
                        transform: `scale(${compareZoom})`,
                        transformOrigin: compareFocus,
                      }}
                    />
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ clipPath: `inset(0 ${100 - compareSplit}% 0 0)` }}
                    >
                      <img
                        src={receipt.beforeUrl}
                        alt="Before Clarify input"
                        draggable={false}
                        className="w-full h-full object-contain p-3 transition-transform duration-200"
                        style={{
                          transform: `scale(${compareZoom})`,
                          transformOrigin: compareFocus,
                        }}
                      />
                    </div>
                    <div
                      className="absolute top-0 bottom-0 w-0.5 pointer-events-none z-20"
                      style={{
                        left: `${compareSplit}%`,
                        backgroundColor: '#22C55E',
                        boxShadow: '0 0 0 1px #111111',
                      }}
                    >
                      <span
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 px-1.5 py-0.5 font-mono text-[9px] font-bold whitespace-nowrap"
                        style={{
                          backgroundColor: '#22C55E',
                          color: '#111111',
                          border: '2px solid #111111',
                        }}
                      >
                        ◀ ▶
                      </span>
                    </div>
                    <span
                      className="absolute bottom-2 left-2.5 z-20 px-1.5 py-0.5 font-mono text-[9px] font-bold"
                      style={{
                        backgroundColor: '#111111',
                        color: '#FFE600',
                        border: '1px solid #FFE600',
                      }}
                    >
                      BEFORE
                    </span>
                    <span
                      className="absolute bottom-2 right-2.5 z-20 px-1.5 py-0.5 font-mono text-[9px] font-bold"
                      style={{
                        backgroundColor: '#111111',
                        color: '#22C55E',
                        border: '1px solid #22C55E',
                      }}
                    >
                      CLARIFIED
                    </span>
                  </div>
                ) : (
                  <img
                    src={activeUrl}
                    alt="KILOWASH Drying Line Output"
                    className="max-w-full max-h-full object-contain p-3"
                  />
                )}
              </div>

              {/* Diegetic Tool Shelf: Spot Bleach & Fabric Patch */}

              {/* Water Drops Dripping Beneath Hanging Output */}
              <div className="flex justify-around w-48 h-9 pointer-events-none">
                {[0, 0.55, 1.05].map((delay, idx) => (
                  <span
                    key={idx}
                    className="w-2.5 h-3.5 rounded-full animate-drip"
                    style={{
                      backgroundColor: 'var(--active-accent)',
                      border: '2px solid var(--ink)',
                      animationDelay: `${delay}s`,
                    }}
                  />
                ))}
              </div>
            </motion.div>

            {canCompareSplit && (
              <div
                className="mb-2 px-2.5 py-1.5 flex flex-wrap items-center justify-center gap-1.5"
                style={{
                  backgroundColor: 'var(--ui-card)',
                  color: 'var(--ui-text)',
                  border: '2.5px solid var(--ink)',
                  boxShadow: '3px 3px 0 var(--shadow-color)',
                }}
              >
                <span className="font-mono text-[10px] font-bold uppercase opacity-80">
                  LOUPE:
                </span>
                {([1, 2, 4] as const).map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => {
                      playMechanicalClick(720);
                      setCompareZoom(z);
                    }}
                    className="neo-btn px-2 py-0.5 font-mono text-[10px] font-bold"
                    style={{
                      backgroundColor:
                        compareZoom === z ? 'var(--clarify-accent)' : 'var(--ui-subtle)',
                      color: compareZoom === z ? '#111111' : 'var(--ui-text)',
                    }}
                  >
                    {z === 1 ? 'FIT' : `${z}X`}
                  </button>
                ))}
                {compareZoom > 1 && (
                  <>
                    <span className="font-mono text-[10px] opacity-40">|</span>
                    {[
                      { origin: '50% 50%' as const, label: 'CTR' },
                      { origin: '28% 28%' as const, label: 'TOP' },
                      { origin: '50% 82%' as const, label: 'TEXT' },
                    ].map((pos) => (
                      <button
                        key={pos.label}
                        type="button"
                        onClick={() => {
                          playMechanicalClick(660);
                          setCompareFocus(pos.origin);
                        }}
                        className="neo-btn px-1.5 py-0.5 font-mono text-[10px] font-bold"
                        style={{
                          backgroundColor:
                            compareFocus === pos.origin ? '#FFE600' : 'var(--ui-subtle)',
                          color: compareFocus === pos.origin ? '#111111' : 'var(--ui-text)',
                        }}
                      >
                        {pos.label}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}

            <TouchUpShelf api={brush} />

            {receipt.mediaKind === 'image' && (
              <div
                className="w-full max-w-[420px] mt-2 p-2.5 flex flex-col gap-2"
                style={{
                  backgroundColor: 'var(--ui-card)',
                  color: 'var(--ui-text)',
                  border: '3px solid var(--ink)',
                  boxShadow: '4px 4px 0 var(--shadow-color)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-adaptive">
                    <Sticker size={12} />
                    HANGER STUDIO // EXPORT FX
                  </span>
                  <div className="flex items-center gap-1.5">
                    {isApplyingFx && (
                      <span className="font-mono text-[9px] font-bold uppercase opacity-75">
                        RENDERING...
                      </span>
                    )}
                    {hasActiveHangerFx(hangerFx) && (
                      <button
                        type="button"
                        disabled={brush.armed}
                        onClick={() => {
                          playMechanicalClick(620);
                          void applyHangerStudio(DEFAULT_HANGER_STUDIO);
                        }}
                        className="neo-btn px-2 py-0.5 font-mono text-[9px] font-bold uppercase disabled:opacity-50"
                        style={{ backgroundColor: '#FFE600', color: '#111111' }}
                      >
                        RESET FX
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[9px] font-bold uppercase opacity-75">
                    EXPORT BG:
                  </span>
                  {(
                    [
                      { id: 'none', label: 'NONE' },
                      { id: 'white', label: 'WHITE' },
                      { id: 'slate', label: 'SLATE' },
                      { id: 'greenscreen', label: '#00FF00' },
                    ] as Array<{ id: ExportBackdropMode; label: string }>
                  ).map((bg) => {
                    const active = hangerFx.backdrop === bg.id;
                    return (
                      <button
                        key={bg.id}
                        type="button"
                        disabled={brush.armed}
                        onClick={() => {
                          playMechanicalClick(700);
                          void applyHangerStudio((prev) => ({ ...prev, backdrop: bg.id }));
                        }}
                        className="neo-btn px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase disabled:opacity-50"
                        style={{
                          backgroundColor: active
                            ? 'var(--active-accent)'
                            : 'var(--ui-subtle)',
                          color: active ? '#111111' : 'var(--ui-text)',
                        }}
                      >
                        {bg.label}
                      </button>
                    );
                  })}
                  <label
                    title="Pick custom export backdrop color"
                    className="neo-btn px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase flex items-center gap-1 cursor-pointer"
                    style={{
                      backgroundColor:
                        hangerFx.backdrop === 'custom'
                          ? 'var(--active-accent)'
                          : 'var(--ui-subtle)',
                      color: hangerFx.backdrop === 'custom' ? '#111111' : 'var(--ui-text)',
                    }}
                  >
                    <input
                      type="color"
                      disabled={brush.armed}
                      value={hangerFx.customColor}
                      onChange={(e) => {
                        const val = e.target.value;
                        void applyHangerStudio((prev) => ({
                          ...prev,
                          backdrop: 'custom',
                          customColor: val,
                        }));
                      }}
                      className="w-3.5 h-3.5 border border-black p-0 bg-transparent cursor-pointer"
                    />
                    CUSTOM
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={brush.armed}
                    onClick={() => {
                      playMechanicalClick(740);
                      void applyHangerStudio((prev) => ({
                        ...prev,
                        dropShadow: !prev.dropShadow,
                      }));
                    }}
                    className="neo-btn px-2 py-1 font-mono text-[10px] font-bold uppercase disabled:opacity-50"
                    style={{
                      backgroundColor: hangerFx.dropShadow ? '#FFE600' : 'var(--ui-subtle)',
                      color: hangerFx.dropShadow ? '#111111' : 'var(--ui-text)',
                    }}
                  >
                    {hangerFx.dropShadow ? '[✓] DROP SHADOW' : '[ ] DROP SHADOW'}
                  </button>

                  <button
                    type="button"
                    disabled={brush.armed}
                    onClick={() => {
                      playMechanicalClick(760);
                      void applyHangerStudio((prev) => ({
                        ...prev,
                        stickerOutline: !prev.stickerOutline,
                      }));
                    }}
                    className="neo-btn px-2 py-1 font-mono text-[10px] font-bold uppercase disabled:opacity-50"
                    style={{
                      backgroundColor: hangerFx.stickerOutline
                        ? 'var(--clarify-accent)'
                        : 'var(--ui-subtle)',
                      color: hangerFx.stickerOutline ? '#111111' : 'var(--ui-text)',
                    }}
                  >
                    {hangerFx.stickerOutline ? '[✓] STICKER OUTLINE' : '[ ] STICKER OUTLINE'}
                  </button>

                  {hangerFx.stickerOutline &&
                    (['sm', 'md', 'lg'] as StickerThickness[]).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        disabled={brush.armed}
                        onClick={() => {
                          playMechanicalClick(680);
                          void applyHangerStudio((prev) => ({ ...prev, stickerSize: sz }));
                        }}
                        className="neo-btn px-1.5 py-1 font-mono text-[9px] font-bold uppercase"
                        style={{
                          backgroundColor:
                            hangerFx.stickerSize === sz ? '#00E5FF' : 'var(--ui-subtle)',
                          color:
                            hangerFx.stickerSize === sz ? '#111111' : 'var(--ui-text)',
                        }}
                      >
                        {sz}
                      </button>
                    ))}
                </div>
              </div>
            )}
            </div>

            {/* RIGHT: HANGING LAUNDRY CARE TAG (RECEIPT) */}
            <motion.div
              animate={{ rotate: [1.1, -1.1, 1.1] }}
              transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut' }}
              style={{ transformOrigin: 'top center' }}
              className="relative flex flex-col items-center"
            >
              {/* Single Clothespin */}
              <div
                className="w-5 h-10 rounded-sm relative z-30 -mb-2.5"
                style={{
                  backgroundColor: '#00E5FF',
                  border: '2.5px solid var(--ink)',
                  boxShadow: '2px 2px 0 var(--shadow-color)',
                }}
              />

              <div
                className="w-full p-4 neo-card"
                style={{ backgroundColor: 'var(--ui-card)', color: 'var(--ui-text)' }}
              >
                <div
                  className="font-mono text-xs font-bold uppercase pb-2 mb-3 border-b-2 border-dashed flex justify-between"
                  style={{ borderColor: 'var(--ink)' }}
                >
                  <span>CARE TAG // RECEIPT</span>
                  <span>#{receipt.durationMs}ms</span>
                </div>

                <dl className="font-mono text-xs space-y-2 text-adaptive">
                  <div className="flex justify-between gap-2">
                    <dt className="opacity-80">ORIGINAL SIZE</dt>
                    <dd className="font-bold">{receipt.originalSizeMB.toFixed(2)} MB</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="opacity-80">FINAL SIZE</dt>
                    <dd
                      className="font-bold px-1.5 text-on-accent"
                      style={{
                        backgroundColor: metTarget ? '#00E5FF' : '#FFE600',
                      }}
                    >
                      {receipt.finalSizeMB.toFixed(2)} MB
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="opacity-80">TARGET MB</dt>
                    <dd className="font-bold">
                      {!receipt.enforcedTargetMB
                        ? receipt.cycle === 'clarify'
                          ? 'N/A (CLARIFY ONLY)'
                          : 'N/A (WASH ONLY)'
                        : `<= ${receipt.targetMB.toFixed(2)} MB`}
                    </dd>
                  </div>
                  {receipt.clarifyBackend && (
                    <div className="flex justify-between gap-2">
                      <dt className="opacity-80">ENHANCE</dt>
                      <dd className="font-bold">
                        {receipt.clarifyBackend === 'ai-webgpu'
                          ? 'AI 4X (WEBGPU)'
                          : receipt.clarifyBackend === 'ai-wasm'
                          ? 'AI 4X (WASM)'
                          : 'STEAM DSP'}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <dt className="opacity-80">REDUCTION %</dt>
                    <dd className="font-bold">
                      {receipt.savedPercent >= 0
                        ? `-${receipt.savedPercent}%`
                        : `+${Math.abs(receipt.savedPercent)}%`}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="opacity-80">RESOLUTION</dt>
                    <dd className="font-bold">
                      {receipt.width}×{receipt.height}px
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="opacity-80">FORMAT</dt>
                    <dd className="font-bold">{receipt.formatLabel}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="opacity-80">FRAMES</dt>
                    <dd className="font-bold">
                      {receipt.frameCount} frame{receipt.frameCount > 1 ? 's' : ''}
                    </dd>
                  </div>
                </dl>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* FOLDING TABLE / LAUNDRY COUNTER BAR AT FLOOR LEVEL */}
      <div
        className="laundry-floor p-4 sm:px-7 flex flex-wrap items-center justify-between gap-3 relative z-20"
        style={{ borderTop: '4px solid var(--ink)' }}
      >
        {/* Backdrop Cloth Switcher + Before/After */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="p-1.5 flex flex-wrap items-center gap-1.5"
            style={{
              backgroundColor: 'var(--ui-card)',
              color: 'var(--ui-text)',
              border: '3px solid var(--ink)',
              boxShadow: '4px 4px 0 var(--shadow-color)',
            }}
          >
            <span className="font-mono text-[10px] font-bold uppercase px-1 text-adaptive">
              BACKDROP:
            </span>
            {[
              { id: 'checker' as const, label: 'TRANSPARENT' },
              { id: 'greenscreen' as const, label: '#00FF00' },
              { id: 'dark' as const, label: 'DARK SLATE' },
              { id: 'white' as const, label: 'WHITE LINEN' },
            ].map((bg) => {
              const active = backdrop === bg.id;
              return (
                <button
                  key={bg.id}
                  type="button"
                  onClick={() => {
                    playMechanicalClick(680);
                    setBackdrop(bg.id);
                  }}
                  className="neo-btn px-2 py-1 font-mono text-[10px] font-bold"
                  style={{
                    backgroundColor: active ? 'var(--active-accent)' : 'var(--ui-subtle)',
                    color: active ? '#111111' : 'var(--ui-text)',
                  }}
                >
                  {bg.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              playMechanicalClick(720);
              setShowBefore((v) => !v);
            }}
            className="neo-btn px-3 py-2 font-mono text-xs font-bold uppercase flex items-center gap-1.5"
            style={{
              backgroundColor: showBefore ? '#FFE600' : 'var(--ui-card)',
              color: showBefore ? '#111111' : 'var(--ui-text)',
            }}
          >
            <Eye size={14} />
            {showBefore ? 'SHOWING: ORIGINAL' : 'PEEK BEFORE / AFTER'}
          </button>
        </div>

        {/* Download & Return to Washer */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              playMechanicalClick(580);
              onBackToWasher();
            }}
            className="neo-btn px-3.5 py-2.5 font-bold text-xs uppercase flex items-center gap-1.5"
            style={{
              backgroundColor: 'var(--ui-card)',
              color: 'var(--ui-text)',
            }}
          >
            <RotateCcw size={15} />
            WASH AGAIN // TO MACHINE
          </button>

          {receipt.mediaKind === 'image' && (
            <button
              type="button"
              onClick={() => {
                void copyPngToClipboard();
              }}
              title="Copy a transparent PNG of this output to the system clipboard"
              className="neo-btn px-3.5 py-2.5 font-bold text-xs uppercase flex items-center gap-1.5"
              style={{
                backgroundColor:
                  copyState === 'ok'
                    ? '#00E5FF'
                    : copyState === 'fail'
                    ? '#FF5416'
                    : 'var(--ui-card)',
                color: copyState === 'idle' ? 'var(--ui-text)' : '#111111',
              }}
            >
              {copyState === 'ok' ? <ClipboardCheck size={15} /> : <Copy size={15} />}
              {copyState === 'ok'
                ? 'PNG COPIED'
                : copyState === 'fail'
                ? 'CLIPBOARD BLOCKED'
                : 'COPY PNG'}
            </button>
          )}

          <button
            type="button"
            onClick={handleDownload}
            className="neo-btn px-4 py-2.5 font-extrabold text-xs sm:text-sm uppercase flex items-center gap-2"
            style={{
              backgroundColor: 'var(--active-accent)',
              color: '#111111',
            }}
          >
            <Download size={16} />
            UNPIN &amp; DOWNLOAD (.{receipt.fileExtension.toUpperCase()})
          </button>
        </div>
      </div>
    </div>
  );
};
