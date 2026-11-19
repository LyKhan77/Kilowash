import React, { useRef } from 'react';
import { Crosshair, Scissors } from 'lucide-react';
import type { CropBox, MediaKind, VideoTrim } from '../types/laundry';

interface PreTreatOverlayProps {
  crop: CropBox;
  onChangeCrop: (next: CropBox) => void;
  disabled?: boolean;
}

/**
 * Interactive Focus Crop Box rendered inside the drum preview frame.
 * Lets users isolate a specific object before running AI Wash.
 */
export const PreTreatCropOverlay: React.FC<PreTreatOverlayProps> = ({
  crop,
  onChangeCrop,
  disabled = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const startDrag = (mode: 'move' | 'resize', e: React.PointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const initCrop = { ...crop };

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;

      if (mode === 'move') {
        const nx = Math.max(0, Math.min(1 - initCrop.width, initCrop.x + dx));
        const ny = Math.max(0, Math.min(1 - initCrop.height, initCrop.y + dy));
        onChangeCrop({ ...initCrop, x: nx, y: ny });
      } else {
        const nw = Math.max(0.22, Math.min(1 - initCrop.x, initCrop.width + dx));
        const nh = Math.max(0.22, Math.min(1 - initCrop.y, initCrop.height + dy));
        onChangeCrop({ ...initCrop, width: nw, height: nh });
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div ref={containerRef} className="absolute inset-0 z-20 select-none">
      {/* Dimmed mask outside crop box */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'rgba(9, 13, 22, 0.42)',
          clipPath: `polygon(
            0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
            ${crop.x * 100}% ${crop.y * 100}%,
            ${crop.x * 100}% ${(crop.y + crop.height) * 100}%,
            ${(crop.x + crop.width) * 100}% ${(crop.y + crop.height) * 100}%,
            ${(crop.x + crop.width) * 100}% ${crop.y * 100}%,
            ${crop.x * 100}% ${crop.y * 100}%
          )`,
        }}
      />

      {/* Interactive Crop Rectangle */}
      <div
        onPointerDown={(e) => startDrag('move', e)}
        className="absolute border-2 border-dashed cursor-move"
        style={{
          left: `${crop.x * 100}%`,
          top: `${crop.y * 100}%`,
          width: `${crop.width * 100}%`,
          height: `${crop.height * 100}%`,
          borderColor: 'var(--active-accent)',
          boxShadow: 'inset 0 0 0 1px #111111',
        }}
      >
        {/* Label badge */}
        <div
          className="absolute top-1 left-1 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase flex items-center gap-1"
          style={{
            backgroundColor: '#111111',
            color: 'var(--active-accent)',
          }}
        >
          <Crosshair size={10} />
          FOCUS {Math.round(crop.width * 100)}%
        </div>

        {/* SE Resize Handle */}
        <div
          onPointerDown={(e) => startDrag('resize', e)}
          title="Drag to resize object focus area"
          className="absolute -right-2 -bottom-2 w-4 h-4 cursor-nwse-resize"
          style={{
            backgroundColor: 'var(--active-accent)',
            border: '2px solid #111111',
          }}
        />
      </div>
    </div>
  );
};

interface PreTreatBarProps {
  mediaKind: MediaKind;
  durationSec: number;
  crop: CropBox;
  onChangeCrop: (next: CropBox) => void;
  trim: VideoTrim;
  onChangeTrim: (next: VideoTrim) => void;
  disabled?: boolean;
}

/**
 * Quick Focus Crop presets + Video Trim & FPS controls situated beneath the drum.
 */
export const PreTreatBar: React.FC<PreTreatBarProps> = ({
  mediaKind,
  durationSec,
  crop,
  onChangeCrop,
  trim,
  onChangeTrim,
  disabled = false,
}) => {
  const applyPreset = (size: number) => {
    const offset = (1 - size) / 2;
    onChangeCrop({ x: offset, y: offset, width: size, height: size });
  };

  const activePreset =
    Math.abs(crop.width - 1) < 0.03
      ? 'full'
      : Math.abs(crop.width - 0.75) < 0.03
      ? '75'
      : Math.abs(crop.width - 0.5) < 0.03
      ? '50'
      : 'custom';

  const maxClipEnd = Math.max(0.5, Number(durationSec.toFixed(1)));

  return (
    <div
      className="mt-4 p-3 border-2"
      style={{
        borderColor: 'var(--ink)',
        backgroundColor: 'var(--ui-subtle)',
        color: 'var(--ui-text)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
          <Crosshair size={13} />
          PRE-TREAT // FOCUS CROP OBJECT
        </span>
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'full', label: 'FULL FRAME', val: 1 },
            { id: '75', label: 'CENTER 75%', val: 0.75 },
            { id: '50', label: 'TIGHT SUBJECT 50%', val: 0.5 },
          ].map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => applyPreset(preset.val)}
              className="neo-btn px-2 py-1 font-mono text-[10px] font-bold uppercase"
              style={{
                backgroundColor:
                  activePreset === preset.id ? 'var(--active-accent)' : 'var(--ui-card)',
                color: activePreset === preset.id ? '#111111' : 'var(--ui-text)',
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {mediaKind === 'video' && (
        <div
          className="pt-2.5 mt-2 border-t-2 flex flex-col gap-2"
          style={{ borderColor: 'var(--ink)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-bold uppercase flex items-center gap-1.5">
              <Scissors size={13} />
              VIDEO TRIM ({trim.start.toFixed(1)}s – {trim.end.toFixed(1)}s / MAX 8s)
            </span>

            <div className="flex items-center gap-1">
              <span className="font-mono text-[10px] font-bold mr-1">FPS:</span>
              {([10, 12, 15] as const).map((fpsOption) => (
                <button
                  key={fpsOption}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChangeTrim({ ...trim, fps: fpsOption })}
                  className="neo-btn px-2 py-0.5 font-mono text-[10px] font-bold"
                  style={{
                    backgroundColor:
                      trim.fps === fpsOption ? 'var(--active-accent)' : 'var(--ui-card)',
                    color: trim.fps === fpsOption ? '#111111' : 'var(--ui-text)',
                  }}
                >
                  {fpsOption}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] opacity-80">
                START: {trim.start.toFixed(1)}s
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0.1, maxClipEnd - 0.4)}
                step={0.1}
                disabled={disabled}
                value={trim.start}
                onChange={(e) => {
                  const nextStart = parseFloat(e.target.value);
                  const nextEnd = Math.min(
                    maxClipEnd,
                    Math.max(nextStart + 0.4, Math.min(trim.end, nextStart + 8))
                  );
                  onChangeTrim({ ...trim, start: nextStart, end: nextEnd });
                }}
                className="swiss-slider w-full"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] opacity-80">
                END: {trim.end.toFixed(1)}s
              </span>
              <input
                type="range"
                min={0.4}
                max={maxClipEnd}
                step={0.1}
                disabled={disabled}
                value={trim.end}
                onChange={(e) => {
                  const rawEnd = parseFloat(e.target.value);
                  const nextEnd = Math.max(trim.start + 0.4, rawEnd);
                  const nextStart =
                    nextEnd - trim.start > 8 ? Math.max(0, nextEnd - 8) : trim.start;
                  onChangeTrim({ ...trim, start: nextStart, end: nextEnd });
                }}
                className="swiss-slider w-full"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
