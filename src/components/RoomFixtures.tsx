import React, { useRef } from 'react';
import { Film, Image as ImageIcon, Upload, Droplets, Gauge, Wrench } from 'lucide-react';
import { playMechanicalClick } from '../utils/laundrySfx';
import type {
  ImageOutputFormat,
  LaundryCycle,
  LoadedMedia,
  VideoOutputFormat,
} from '../types/laundry';

interface LaundryBasketFixtureProps {
  media: LoadedMedia | null;
  isProcessing: boolean;
  isGeneratingSample: boolean;
  onFileSelected: (file: File) => void;
  onLoadSampleImage: () => void;
  onLoadSampleVideo: () => void;
}

/**
 * Diegetic Dirty Laundry Basket sitting on the left floor of the Laundromat room.
 * Holds uploaded files & pulls out sample meme garments.
 */
export const LaundryBasketFixture: React.FC<LaundryBasketFixtureProps> = ({
  media,
  isProcessing,
  isGeneratingSample,
  onFileSelected,
  onLoadSampleImage,
  onLoadSampleVideo,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="w-full max-w-[235px] flex flex-col">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = '';
        }}
      />

      {/* Sample Garment Tags sticking out of the top of the basket */}
      <div className="flex items-end gap-1.5 px-2 -mb-1 relative z-10">
        <button
          type="button"
          disabled={isProcessing || isGeneratingSample}
          onClick={onLoadSampleImage}
          className="neo-btn px-2 py-1.5 font-mono text-[10px] font-bold uppercase flex items-center gap-1 -rotate-2"
          style={{
            backgroundColor: '#FFE600',
            color: '#111111',
          }}
          title="Load sample meme image"
        >
          <ImageIcon size={11} />
          MEME IMG
        </button>

        <button
          type="button"
          disabled={isProcessing || isGeneratingSample}
          onClick={onLoadSampleVideo}
          className="neo-btn px-2 py-1.5 font-mono text-[10px] font-bold uppercase flex items-center gap-1 rotate-2"
          style={{
            backgroundColor: '#00E5FF',
            color: '#111111',
          }}
          title="Load sample meme video"
        >
          <Film size={11} />
          {isGeneratingSample ? 'WAIT...' : 'MEME VID'}
        </button>
      </div>

      {/* Basket Rim */}
      <div
        className="h-4 rounded-sm relative z-20"
        style={{
          backgroundColor: 'var(--basket-rim)',
          border: '3px solid var(--ink)',
          boxShadow: '4px 4px 0 var(--shadow-color)',
        }}
      />

      {/* Basket Body */}
      <div
        className="p-3 relative z-10"
        style={{
          backgroundColor: 'var(--basket-body)',
          color: 'var(--ui-text)',
          border: '3px solid var(--ink)',
          borderTop: 'none',
          boxShadow: '5px 5px 0 var(--shadow-color)',
        }}
      >
        {/* Woven ventilation slots */}
        <div className="grid grid-cols-4 gap-1.5 mb-2.5">
          {[0, 1, 2, 3].map((slot) => (
            <div
              key={slot}
              className="h-2 rounded-full"
              style={{ backgroundColor: 'var(--ink)', opacity: 0.45 }}
            />
          ))}
        </div>

        <button
          type="button"
          disabled={isProcessing || isGeneratingSample}
          onClick={() => inputRef.current?.click()}
          className="neo-btn w-full py-2 px-2.5 font-bold text-xs uppercase flex items-center justify-center gap-1.5"
          style={{
            backgroundColor: 'var(--active-accent)',
            color: '#111111',
          }}
        >
          <Upload size={14} />
          {media ? 'CHANGE LOAD' : 'LOAD BASKET'}
        </button>

        {media ? (
          <div
            className="mt-2 p-1.5 border-2 font-mono text-[10px] leading-tight"
            style={{
              borderColor: 'var(--ink)',
              backgroundColor: 'var(--ui-card)',
              color: 'var(--ui-text)',
            }}
          >
            <div className="font-bold truncate">{media.file.name}</div>
            <div className="opacity-80 mt-0.5">
              {media.width}×{media.height} • {media.sizeMB.toFixed(2)} MB
            </div>
          </div>
        ) : (
          <p className="font-mono text-[10px] mt-2 leading-snug text-adaptive opacity-90">
            Click basket or pull a Meme tag to load media into the drum.
          </p>
        )}
      </div>
    </div>
  );
};

interface WallDispenserRackFixtureProps {
  media: LoadedMedia | null;
  cycle: LaundryCycle;
  onChangeCycle: (c: LaundryCycle) => void;
  targetMB: number;
  onChangeTargetMB: (mb: number) => void;
  imageFormat: ImageOutputFormat;
  onChangeImageFormat: (fmt: ImageOutputFormat) => void;
  videoFormat: VideoOutputFormat;
  onChangeVideoFormat: (fmt: VideoOutputFormat) => void;
  isProcessing: boolean;
}

const TARGET_PRESETS = [0.2, 0.5, 1.0, 2.0, 5.0, 8.0];

/**
 * Diegetic Wall-Mounted Detergent Dispenser, Digital MB Scale & Drain Valve Unit
 * fixed on the right tiled wall of the Laundromat room.
 */
export const WallDispenserRackFixture: React.FC<WallDispenserRackFixtureProps> = ({
  media,
  cycle,
  onChangeCycle,
  targetMB,
  onChangeTargetMB,
  imageFormat,
  onChangeImageFormat,
  videoFormat,
  onChangeVideoFormat,
  isProcessing,
}) => {
  const spinEnabled = cycle === 'spin' || cycle === 'both';
  const activeKind = media?.kind ?? 'image';

  return (
    <div className="w-full flex flex-col gap-3 relative">
      {/* Wall Pipe Connecting Dispenser to Machine */}
      <div
        className="hidden lg:block absolute -left-6 top-12 w-6 h-3"
        style={{
          backgroundColor: 'var(--pipe)',
          borderTop: '3px solid var(--ink)',
          borderBottom: '3px solid var(--ink)',
        }}
      />

      {/* UNIT 01: DETERGENT POD DISPENSER (SELECT CYCLE) */}
      <div className="neo-card p-3">
        <div
          className="flex items-center justify-between border-b-2 pb-1.5 mb-2.5"
          style={{ borderColor: 'var(--ink)' }}
        >
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-adaptive">
            01 // DETERGENT PODS
          </span>
          <Droplets size={14} className="text-adaptive" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            {
              id: 'wash' as const,
              title: 'WASH',
              sub: 'BG AI',
              color: 'var(--wash-accent)',
            },
            {
              id: 'spin' as const,
              title: 'SPIN',
              sub: 'MB',
              color: 'var(--spin-accent)',
            },
            {
              id: 'both' as const,
              title: 'BOTH',
              sub: 'FULL',
              color: 'var(--both-accent)',
            },
          ].map((pod) => {
            const active = cycle === pod.id;
            return (
              <button
                key={pod.id}
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  playMechanicalClick(740);
                  onChangeCycle(pod.id);
                }}
                className="neo-btn p-2 flex flex-col items-center text-center relative"
                style={{
                  backgroundColor: active ? pod.color : 'var(--ui-subtle)',
                  color: active ? '#111111' : 'var(--ui-text)',
                }}
              >
                <span
                  className="w-5 h-1.5 mb-1.5"
                  style={{
                    backgroundColor: active ? '#111111' : pod.color,
                    border: '1px solid #111111',
                  }}
                />
                <span className="font-extrabold text-[11px] leading-none">{pod.title}</span>
                <span className="font-mono text-[9px] mt-1 opacity-85">{pod.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* UNIT 02: DIGITAL WEIGHT SCALE (TARGET IN MB) */}
      <div
        className="neo-card p-3 transition-opacity"
        style={{ opacity: spinEnabled ? 1 : 0.6 }}
      >
        <div
          className="flex items-center justify-between border-b-2 pb-1.5 mb-2.5"
          style={{ borderColor: 'var(--ink)' }}
        >
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-adaptive">
            02 // WEIGHT SCALE (MB)
          </span>
          <Gauge size={14} className="text-adaptive" />
        </div>

        {/* Scale Digital LCD */}
        <div
          className="p-2 mb-2 flex items-center gap-1.5"
          style={{
            backgroundColor: '#0B1014',
            border: '2.5px solid var(--ink)',
          }}
        >
          <button
            type="button"
            disabled={!spinEnabled || isProcessing}
            onClick={() => {
              playMechanicalClick(620);
              onChangeTargetMB(Math.max(0.05, Number((targetMB - 0.25).toFixed(2))));
            }}
            className="px-2 py-1 font-mono font-bold text-xs border border-slate-600 text-white hover:bg-slate-800 disabled:opacity-40"
          >
            -
          </button>
          <input
            type="number"
            min={0.05}
            max={50}
            step={0.05}
            disabled={!spinEnabled || isProcessing}
            value={targetMB}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!Number.isNaN(val)) {
                onChangeTargetMB(Math.max(0.05, Math.min(50, val)));
              }
            }}
            className="w-full bg-transparent text-center font-mono font-bold text-sm outline-none"
            style={{ color: 'var(--active-accent)' }}
          />
          <span className="font-mono text-[11px] font-bold text-slate-300 pr-1">MB</span>
          <button
            type="button"
            disabled={!spinEnabled || isProcessing}
            onClick={() => {
              playMechanicalClick(760);
              onChangeTargetMB(Math.min(50, Number((targetMB + 0.25).toFixed(2))));
            }}
            className="px-2 py-1 font-mono font-bold text-xs border border-slate-600 text-white hover:bg-slate-800 disabled:opacity-40"
          >
            +
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {TARGET_PRESETS.map((preset) => {
            const active = Math.abs(targetMB - preset) < 0.01 && spinEnabled;
            return (
              <button
                key={preset}
                type="button"
                disabled={!spinEnabled || isProcessing}
                onClick={() => {
                  playMechanicalClick(700);
                  onChangeTargetMB(preset);
                }}
                className="neo-btn py-1 font-mono text-[10px] font-bold"
                style={{
                  backgroundColor: active ? 'var(--spin-accent)' : 'var(--ui-subtle)',
                  color: active ? '#111111' : 'var(--ui-text)',
                }}
              >
                {preset}MB
              </button>
            );
          })}
        </div>
      </div>

      {/* UNIT 03: DRAIN VALVE FORMAT SELECTOR */}
      <div className="neo-card p-3">
        <div
          className="flex items-center justify-between border-b-2 pb-1.5 mb-2.5"
          style={{ borderColor: 'var(--ink)' }}
        >
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-adaptive">
            03 // OUTPUT VALVE ({activeKind.toUpperCase()})
          </span>
          <Wrench size={14} className="text-adaptive" />
        </div>

        {activeKind === 'image' ? (
          <div className="flex flex-col gap-1.5">
            {[
              { id: 'webp' as const, label: 'WebP Transparent', tag: 'BEST MB' },
              { id: 'png' as const, label: 'PNG Transparent', tag: 'PNG' },
              { id: 'jpeg' as const, label: 'JPG Solid White', tag: 'JPG' },
            ].map((fmt) => {
              const active = imageFormat === fmt.id;
              return (
                <button
                  key={fmt.id}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    playMechanicalClick(660);
                    onChangeImageFormat(fmt.id);
                  }}
                  className="neo-btn px-2.5 py-1.5 text-[11px] font-bold flex items-center justify-between"
                  style={{
                    backgroundColor: active ? 'var(--active-accent)' : 'var(--ui-subtle)',
                    color: active ? '#111111' : 'var(--ui-text)',
                  }}
                >
                  <span>{fmt.label}</span>
                  <span className="font-mono text-[9px]">{fmt.tag}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {[
              { id: 'gif' as const, label: 'GIF Transparent', tag: 'MEME' },
              { id: 'webm' as const, label: 'WebM Transparent', tag: 'ALPHA' },
              { id: 'greenscreen' as const, label: 'Green Screen', tag: '#00FF00' },
            ].map((fmt) => {
              const active = videoFormat === fmt.id;
              return (
                <button
                  key={fmt.id}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    playMechanicalClick(660);
                    onChangeVideoFormat(fmt.id);
                  }}
                  className="neo-btn px-2.5 py-1.5 text-[11px] font-bold flex items-center justify-between"
                  style={{
                    backgroundColor: active ? 'var(--active-accent)' : 'var(--ui-subtle)',
                    color: active ? '#111111' : 'var(--ui-text)',
                  }}
                >
                  <span>{fmt.label}</span>
                  <span className="font-mono text-[9px]">{fmt.tag}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
