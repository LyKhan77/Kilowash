# AGENTS.md — Engineering Guide for KILOWASH // SYS-24H

This document provides context, architectural boundaries, visual rules, and verification procedures for AI coding agents and human contributors working on **KILOWASH (`KILOWASH // SYS-24H`)**.

---

## 1. Project Overview & Core Principles

- **Product:** A 100% client-side **AI Background Remover** and **Target-MB Image/Video/GIF Compressor** styled as an interactive 24-hour self-service laundromat.
- **Zero Backend:** All inference, frame extraction, compression, and encoding run strictly in the user's browser. Never introduce server upload endpoints unless explicitly requested.
- **Language Standard:** All user-facing copy, UI labels, tooltips, error messages, and documentation must be written in **English**.
- **Active Task Tracking (`todo.md`):** Before starting any implementation or maintenance task batch, agents MUST maintain a local gitignored root `todo.md` listing only the tasks currently in progress. Update checkboxes as work progresses, and **always overwrite `todo.md` completely** when previous tasks are finished and a new set of tasks begins (never append endlessly to old completed backlogs).

---

## 2. Directory & Module Map

```text
├── index.html                           # HTML shell (lang="en", Space Grotesk + JetBrains Mono fonts)
├── package.json                         # Dependencies & build scripts
├── todo.md                              # Local gitignored active agent task checklist (created/overwritten at runtime)
├── src/
│   ├── main.tsx                         # React entry point
│   ├── index.css                        # Palet A Day/Night CSS variables, Neo-Brutalist utilities, keyframes
│   ├── App.tsx                          # Top header bar, scene switcher (washer <-> drying), file inspection & state
│   ├── types/
│   │   ├── laundry.ts                   # Core TypeScript types (ThemeShift, LaundryCycle, RoomScene, WashProgress, LaundryReceipt)
│   │   ├── workerMessages.ts            # Main-thread <-> media worker message protocol
│   │   └── gifenc.d.ts                  # Type declarations for gifenc
│   ├── workers/
│   │   └── mediaWorker.ts               # Dedicated worker: RMBG-1.4 (WebGPU fp16 -> WASM q8) + Sobel fallback + gifenc GIF/PNG Target-MB solvers
│   ├── components/
│   │   ├── ThemeToggle.tsx              # Day/Night Shift toggle inspired by rishichawda/fluffy-robin-48
│   │   ├── CreatorSpotlight.tsx         # Compact 3D Voxel operator avatar (/models/lee-voxel.glb) + creator popover
│   │   ├── LaundryMachine.tsx           # Centerpiece 2.5D washer (built-in START button, rotary dial, multi-stage drum)
│   │   ├── PreTreatOverlay.tsx          # Focus Crop Box overlay + Video Trim & FPS controls (PreTreatCropOverlay, PreTreatBar)
│   │   ├── RoomFixtures.tsx             # Diegetic room fixtures (LaundryBasketFixture, WallDispenserRackFixture)
│   │   ├── TouchUpBrush.tsx             # Scene 2 spot bleach / fabric patch brush (10-step undo, size dial, cursor ring)
│   │   └── DryingLineScene.tsx          # Scene 2 clothesline drying room, clothespins, hanging Care Tag receipt & download
│   ├── services/
│   │   ├── aiBackgroundRemover.ts       # Thin worker client: bitmap transfer + temporal alpha smoothing handoff
│   │   ├── mediaWorkerClient.ts         # Worker singleton, job routing, progress events, crash recovery
│   │   └── mediaPipeline.ts             # Multi-stage cleaning timeline, Target-MB binary-search solver, WebM encoder
│   └── utils/
│       ├── laundrySfx.ts                # Procedural Web Audio API SFX engine (clicks, latch, stage loops, chime)
│       └── sampleMedia.ts               # Built-in generators for sample meme PNG and animated WebM test clips
└── docs/
    ├── palette-preview.html             # Interactive palette comparison prototype
    └── superpowers/specs/               # Design specifications
```

---

## 3. Design System Rules (Neo-Brutalism × Swiss Style — Palet A)

1. **Diegetic Full-Room UI:**
   - Do not add generic floating sidebars or detached SaaS forms. Every control belongs to a physical fixture in the 2.5D laundromat room (`LaundryBasketFixture` on the left floor, `LaundryMachine` with built-in `START` button in the center, `WallDispenserRackFixture` on the right wall, and `DryingLineScene` in Scene 2).
2. **Day Shift vs. Night Shift Contrast (`[data-shift='day' | 'night']`):**
   - Theme tokens live in `src/index.css`.
   - Always use `.text-adaptive` or `color: var(--ui-text)` for text rendered on room cards/panels (`#111111` in Day Shift, `#F8FAFC` in Night Shift).
   - Only use `#111111` (`.text-on-accent`) on bright accent surfaces (`#00E5FF`, `#FF5416`, `#FFE600`) or light linen backdrops.
   - Maintain thick Neo-Brutalist ink borders (`3px`–`4px solid var(--ink)`) and hard offset shadows (`--shadow-color`), paired with `--night-rim` subtle highlights in Night Shift so dark containers never blend into the slate wall.
3. **Cycle Accent Colors:**
   - `wash` (AI Background Removal): `#00E5FF`
   - `spin` (Target-MB Compression): `#FF5416`
   - `both` (Wash + Spin): `#FFE600`

---

## 4. AI & Media Pipeline Guidelines

1. **Segmentation Model (`src/workers/mediaWorker.ts`, client: `src/services/aiBackgroundRemover.ts`):**
   - Uses **`briaai/RMBG-1.4`** via `@huggingface/transformers` with explicit custom config (`model_type: 'custom'`, `size: { width: 1024, height: 1024 }`, `image_mean: [0.5, 0.5, 0.5]`, `image_std: [1, 1, 1]`).
   - Inference runs **only inside the dedicated module worker** (`src/workers/mediaWorker.ts`), never on the main thread. The worker probes `navigator.gpu` and loads `fp16` on **WebGPU** first, then falls back to WASM `q8`; a failed WebGPU session is remembered for the worker's lifetime.
   - Do **not** switch back to portrait-only models like `Xenova/modnet`, as they erase non-human general objects (vehicles, illustrations, products).
   - Frames cross the thread boundary as transferable `ImageBitmap`s and masks as transferable `Float32Array`s (zero-copy). Maintain **Temporal Alpha Smoothing** (`0.82 * current + 0.18 * prev`) for consecutive video frames and preserve the **Sobel edge-barrier offline fallback** (`fallbackBorderSegmentation`) inside the worker.
   - `mediaWorkerClient.ts` aborts a job after **300 s without any message for it** (`JOB_SILENCE_LIMIT_MS`), then terminates and respawns the worker. The window is deliberately generous: the WASM fallback does session creation + the first 1024² inference inside one opaque `await` (measured 110 s on a Chromium build without SIMD/threads), and a liveness heartbeat would only hide a hung call. Every worker job type SHOULD still emit periodic progress (`MODEL_PROGRESS` / `GIF_PROGRESS` / `PNG_PROGRESS`) between long steps.
   - No DOM APIs may leak into the worker: use `OffscreenCanvas` / `RawImage.fromCanvas(offscreen)` and `ctx.transferToImageBitmap()`. `MediaRecorder` and `<video>` frame extraction stay on the main thread by design.
2. **Target-MB Compression (`src/services/mediaPipeline.ts`):**
   - Target byte budget is `Math.floor(targetMB * 1024 * 1024 * 0.98)`.
   - Images use a 7-iteration quality binary search with adaptive resolution downscaling (`WebP`/`JPEG`) or palette quantization (`PNG`). The PNG palette/scale descent runs in the worker (`runPngEncoding`) because it can burn ~28 synchronous quantize passes.
   - Videos/GIFs are capped at **8 seconds** (`10 / 12 / 15 FPS`, max working dimension `640px`). Animated GIFs use `gifenc` with magenta transparency key `[255, 0, 255]`, `dispose: 2`, and iterative color/scale reduction — the entire color/scale descent runs in `src/workers/mediaWorker.ts` so palette quantization never blocks the UI. WebM and `#00FF00` Green Screen exports budget `videoBitsPerSecond` from duration and target size.
3. **Theatrical Multi-Stage Cleaning Timeline:**
   - Single-image cycles run through `filling` → `washing` (with concurrent AI inference) → `rinsing` → `spinning` → `done`, then auto-transition `activeScene` to `'drying'`.
4. **Scene 2 Touch-Up (`src/components/TouchUpBrush.tsx`):**
   - Every committed stroke re-encodes the canvas via `reencodeImageCanvas` (re-running the Target-MB solver when `cycle` is `spin` or `both`) and calls `onOutputEdited`, which replaces `receipt.outputBlob` / `outputUrl` / `finalSizeMB` / `savedPercent` / `width` / `height` in `App.tsx`. The receipt stays the single source of truth for download and clipboard export — never keep an edited bitmap that the download button would not ship.
   - The brush only applies to `receipt.mediaKind === 'image'`; the sway animation is paused while armed so pointer→pixel mapping stays exact, and `<canvas>` dimensions stay locked for the armed session so Target-MB downscaling does not clear live strokes.

---

## 5. Verification Commands

Run these checks before completing any change:

```bash
# Start local development server
npx vite --port 5156

# TypeScript type-check and production Vite build
npm run build

# Smoke the built bundle (worker chunk, RMBG segmentation, PNG target, 60 FPS room)
# Needs network on the first run: the browser profile downloads the RMBG-1.4 weights.
npm run smoke
```

`npm run smoke` builds, serves `dist/` on port **5157** (never reuses a dev server), and runs four tests: an online MEME IMG → PNG 0.05 MB cycle (asserts output magic bytes, Target-MB budget), an offline cycle with the model hosts blocked (asserts the Sobel `OFFLINE FALLBACK` path and non-empty transparency), a Scene 2 Touch-Up Brush edit on a Target-MB PNG (asserts receipt update + budget compliance), and a `MEME VID` → `GIF Transparent` worker encoding cycle.

When modifying UI components or themes, visually verify both `day` and `night` shifts across Scene 1 (`washer`) and Scene 2 (`drying`) in a real browser.
