import React, { useEffect, useRef, useState } from 'react';
import { Brush, Check, Eraser, Redo2, Undo2 } from 'lucide-react';
import { cropSourceToCanvas, reencodeImageCanvas } from '../services/mediaPipeline';
import { playBrushHiss, playMechanicalClick, playRotaryDialTick } from '../utils/laundrySfx';
import type { CropBox, ImageOutputFormat } from '../types/laundry';

export type TouchUpTool = 'erase' | 'patch';

const MIN_SIZE = 8;
const MAX_SIZE = 64;
const MAX_SNAPSHOTS = 10;

export interface TouchUpBrushApi {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  wrapperRef: React.RefObject<HTMLDivElement>;
  cursorRef: React.RefObject<HTMLDivElement>;
  armed: boolean;
  ready: boolean;
  tool: TouchUpTool;
  size: number;
  canUndo: boolean;
  canRedo: boolean;
  canPatch: boolean;
  editable: boolean;
  onPointerDown: React.PointerEventHandler<HTMLCanvasElement>;
  onPointerMove: React.PointerEventHandler<HTMLCanvasElement>;
  onPointerUp: React.PointerEventHandler<HTMLCanvasElement>;
  onPointerLeave: React.PointerEventHandler<HTMLCanvasElement>;
  arm: (tool: TouchUpTool) => void;
  disarm: () => void;
  changeSize: (size: number) => void;
  undo: () => void;
  redo: () => void;
}

interface TouchUpOptions {
  editable: boolean;
  outputUrl: string;
  outputWidth: number;
  outputHeight: number;
  originalUrl: string | null;
  crop: CropBox;
  format: ImageOutputFormat;
  enforceTargetMB: boolean;
  targetMB: number;
  onCommit: (blob: Blob, width: number, height: number) => void;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load the image for touch-up.'));
    img.src = url;
  });
}

/**
 * Spot bleach (destination-out erase) + fabric patch (restore from the cropped original)
 * on the hanging output. All compositing happens locally on a canvas; every committed
 * stroke is re-encoded and pushed back into the receipt.
 */
export function useTouchUpBrush(options: TouchUpOptions): TouchUpBrushApi {
  const {
    editable,
    outputUrl,
    outputWidth,
    outputHeight,
    originalUrl,
    crop,
    format,
    enforceTargetMB,
    targetMB,
    onCommit,
  } = options;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);

  const snapshotsRef = useRef<ImageBitmap[]>([]);
  const historyCursorRef = useRef(0);
  const originalRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const commitSeqRef = useRef(0);
  const unmountedRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const [armed, setArmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<TouchUpTool>('erase');
  const [size, setSize] = useState(24);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const releaseSnapshots = () => {
    for (const snapshot of snapshotsRef.current) snapshot.close();
    snapshotsRef.current = [];
    historyCursorRef.current = 0;
  };

  const syncHistoryFlags = () => {
    const count = snapshotsRef.current.length;
    setCanUndo(historyCursorRef.current > 0);
    setCanRedo(historyCursorRef.current < count - 1);
  };

  const encodeAndCommit = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const seq = ++commitSeqRef.current;
    try {
      const encoded = await reencodeImageCanvas(canvas, {
        format,
        enforceTargetMB,
        targetMB,
      });
      if (unmountedRef.current || seq !== commitSeqRef.current) return;
      onCommitRef.current(encoded.blob, encoded.width, encoded.height);
    } catch {
      /* ignore encode failure if canvas/worker was torn down mid-edit */
    }
  };

  // Load the hanging output once per armed session. Output URL changes on every commit,
  // so it is intentionally not a dependency of this effect.
  useEffect(() => {
    if (!armed) {
      releaseSnapshots();
      originalRef.current = null;
      lastPointRef.current = null;
      drawingRef.current = false;
      setReady(false);
      setCanUndo(false);
      setCanRedo(false);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    (async () => {
      const outputImage = await loadImage(outputUrl);
      if (cancelled) return;

      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(outputImage, 0, 0, canvas.width, canvas.height);

      originalRef.current = null;
      if (originalUrl) {
        try {
          const originalImage = await loadImage(originalUrl);
          if (originalImage.naturalWidth > 0) {
            originalRef.current = cropSourceToCanvas(
              originalImage,
              originalImage.naturalWidth,
              originalImage.naturalHeight,
              crop
            );
          }
        } catch {
          originalRef.current = null;
        }
      }
      if (cancelled) return;

      releaseSnapshots();
      const base = await createImageBitmap(canvas);
      if (cancelled) {
        base.close();
        return;
      }
      snapshotsRef.current = [base];
      historyCursorRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
      setReady(true);
    })().catch(() => {
      if (!cancelled) setReady(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  useEffect(() => {
    if (!editable && armed) setArmed(false);
  }, [editable, armed]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      for (const snapshot of snapshotsRef.current) snapshot.close();
      snapshotsRef.current = [];
    };
  }, []);

  const stamp = (x: number, y: number, radius: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    if (tool === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    const original = originalRef.current;
    if (!original) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(original, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  };

  const paintTo = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const scale = canvas.width / rect.width;
    const x = (clientX - rect.left) * scale;
    const y = (clientY - rect.top) * scale;
    const radius = Math.max(1, (size / 2) * scale);
    const last = lastPointRef.current;

    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const distance = Math.hypot(dx, dy);
      const step = Math.max(1, radius * 0.35);
      const steps = Math.max(1, Math.ceil(distance / step));
      for (let i = 1; i <= steps; i++) {
        stamp(last.x + (dx * i) / steps, last.y + (dy * i) / steps, radius);
      }
    } else {
      stamp(x, y, radius);
    }
    lastPointRef.current = { x, y };
  };

  const pushSnapshot = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const snapshot = await createImageBitmap(canvas);
    const snapshots = snapshotsRef.current.slice(0, historyCursorRef.current + 1);
    for (const dropped of snapshotsRef.current.slice(historyCursorRef.current + 1)) {
      dropped.close();
    }
    snapshots.push(snapshot);
    let cursor = snapshots.length - 1;
    while (snapshots.length > MAX_SNAPSHOTS) {
      const evicted = snapshots.shift();
      evicted?.close();
      cursor -= 1;
    }
    snapshotsRef.current = snapshots;
    historyCursorRef.current = Math.max(0, cursor);
    syncHistoryFlags();
  };

  const applySnapshotAt = (index: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const snapshot = snapshotsRef.current[index];
    if (!canvas || !ctx || !snapshot) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(snapshot, 0, 0);
    historyCursorRef.current = index;
    syncHistoryFlags();
    void encodeAndCommit();
  };

  const commitStroke = async () => {
    await pushSnapshot();
    await encodeAndCommit();
  };

  const updateCursorRing = (event: React.PointerEvent<HTMLCanvasElement>, visible: boolean) => {
    const ring = cursorRef.current;
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!ring || !wrapper || !canvas) return;

    if (!visible) {
      ring.style.opacity = '0';
      return;
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    ring.style.left = `${event.clientX - wrapperRect.left}px`;
    ring.style.top = `${event.clientY - wrapperRect.top}px`;
    ring.style.width = `${size}px`;
    ring.style.height = `${size}px`;
    ring.style.borderColor = tool === 'erase' ? '#FF5416' : '#00E5FF';
    ring.style.opacity = '1';
  };

  const onPointerDown: React.PointerEventHandler<HTMLCanvasElement> = (event) => {
    if (!armed || !ready) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = null;
    playBrushHiss();
    paintTo(event.clientX, event.clientY);
  };

  const onPointerMove: React.PointerEventHandler<HTMLCanvasElement> = (event) => {
    updateCursorRing(event, true);
    if (!drawingRef.current) return;
    paintTo(event.clientX, event.clientY);
  };

  const onPointerUp: React.PointerEventHandler<HTMLCanvasElement> = (event) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }
    void commitStroke();
  };

  const onPointerLeave: React.PointerEventHandler<HTMLCanvasElement> = (event) => {
    updateCursorRing(event, false);
  };

  const arm = (nextTool: TouchUpTool) => {
    if (nextTool === 'patch' && !originalUrl) return;
    playMechanicalClick(nextTool === 'erase' ? 720 : 860);
    setTool(nextTool);
    setArmed(true);
  };

  const disarm = () => {
    playMechanicalClick(560);
    setArmed(false);
  };

  const changeSize = (nextSize: number) => {
    playRotaryDialTick();
    setSize(Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(nextSize))));
  };

  return {
    canvasRef,
    wrapperRef,
    cursorRef,
    armed,
    ready,
    tool,
    size,
    canUndo,
    canRedo,
    canPatch: Boolean(originalUrl),
    editable,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    arm,
    disarm,
    changeSize,
    undo: () => {
      if (historyCursorRef.current <= 0) return;
      playMechanicalClick(620);
      applySnapshotAt(historyCursorRef.current - 1);
    },
    redo: () => {
      if (historyCursorRef.current >= snapshotsRef.current.length - 1) return;
      playMechanicalClick(700);
      applySnapshotAt(historyCursorRef.current + 1);
    },
  };
}

/**
 * The hanging sheet while the touch-up brush is armed: shows the editable canvas plus a
 * ring cursor (red `-` bleach, cyan `+` patch).
 */
export const TouchUpCanvas: React.FC<{ api: TouchUpBrushApi }> = ({ api }) => (
  <div
    ref={api.wrapperRef}
    className="relative flex items-center justify-center max-w-full max-h-full"
  >
    {/* Canvas dimensions are set once on arm() so Target-MB re-encodes never wipe live strokes. */}
    <canvas
      ref={api.canvasRef}
      onPointerDown={api.onPointerDown}
      onPointerMove={api.onPointerMove}
      onPointerUp={api.onPointerUp}
      onPointerCancel={api.onPointerUp}
      onPointerLeave={api.onPointerLeave}
      className="max-w-full max-h-full object-contain touch-none cursor-crosshair"
      style={{ maxHeight: 292 }}
    />
    <div
      ref={api.cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute z-30 rounded-full opacity-0"
      style={{
        border: '2px solid #FF5416',
        transform: 'translate(-50%, -50%)',
        boxShadow: '0 0 0 2px rgba(17, 17, 17, 0.55)',
      }}
    />
  </div>
);

/**
 * Diegetic tool shelf under the clothesline: bleach/patch tools, brush size dial, undo/redo.
 */
export const TouchUpShelf: React.FC<{ api: TouchUpBrushApi }> = ({ api }) => {
  if (!api.editable) return null;

  const toolButton = (id: TouchUpTool, label: string, icon: React.ReactNode, accent: string) => {
    const active = api.armed && api.tool === id;
    const disabled = id === 'patch' && !api.canPatch;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => api.arm(id)}
        className="neo-btn px-2 py-1.5 font-mono text-[10px] font-bold uppercase flex items-center gap-1 whitespace-nowrap"
        style={{
          backgroundColor: active ? accent : 'var(--ui-subtle)',
          color: active ? '#111111' : 'var(--ui-text)',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        {icon}
        {label}
      </button>
    );
  };

  return (
    <div
      className="w-full max-w-[420px] mt-2 p-2 flex flex-col gap-2"
      style={{
        backgroundColor: 'var(--ui-card)',
        color: 'var(--ui-text)',
        border: '3px solid var(--ink)',
        boxShadow: '4px 4px 0 var(--shadow-color)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-bold uppercase text-adaptive">
          {api.armed ? 'TOUCH-UP ACTIVE // BRUSH THE HANGING OUTPUT' : 'SPOT BLEACH & FABRIC PATCH'}
        </span>
        {api.armed && (
          <button
            type="button"
            onClick={api.disarm}
            className="neo-btn px-2 py-1 font-mono text-[10px] font-bold uppercase flex items-center gap-1"
            style={{ backgroundColor: '#FFE600', color: '#111111' }}
          >
            <Check size={11} />
            DONE
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {toolButton('erase', 'BLEACH -', <Eraser size={11} />, '#FF5416')}
        {toolButton('patch', 'PATCH +', <Brush size={11} />, '#00E5FF')}

        <span
          aria-hidden="true"
          className="w-[2px] h-6 opacity-25"
          style={{ backgroundColor: 'var(--ui-text)' }}
        />

        <label className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase text-adaptive">
          SIZE
          <input
            type="range"
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={2}
            value={api.size}
            aria-label="Brush size in pixels"
            onChange={(event) => api.changeSize(Number(event.target.value))}
            className="w-20 cursor-pointer accent-[var(--active-accent)]"
          />
          <span className="tabular-nums">{api.size}px</span>
        </label>

        <span
          aria-hidden="true"
          className="w-[2px] h-6 opacity-25"
          style={{ backgroundColor: 'var(--ui-text)' }}
        />

        <button
          type="button"
          onClick={api.undo}
          disabled={!api.canUndo}
          aria-label="Undo touch-up stroke"
          className="neo-btn w-[26px] h-[26px] flex items-center justify-center"
          style={{
            backgroundColor: 'var(--ui-subtle)',
            color: 'var(--ui-text)',
            opacity: api.canUndo ? 1 : 0.4,
          }}
        >
          <Undo2 size={12} />
        </button>
        <button
          type="button"
          onClick={api.redo}
          disabled={!api.canRedo}
          aria-label="Redo touch-up stroke"
          className="neo-btn w-[26px] h-[26px] flex items-center justify-center"
          style={{
            backgroundColor: 'var(--ui-subtle)',
            color: 'var(--ui-text)',
            opacity: api.canRedo ? 1 : 0.4,
          }}
        >
          <Redo2 size={12} />
        </button>
      </div>
    </div>
  );
};
