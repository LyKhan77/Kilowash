# Changelog

All notable changes to **KILOWASH // SYS-24H** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Active Task Tracking & Repo Hygiene (`AGENTS.md`, `todo.md`, `.gitignore`):** Added explicit `todo.md` overwrite tracking rules in `AGENTS.md`, initialized root `todo.md`, synced `package.json` / `package-lock.json` to `1.4.0`, and added `.gitignore` for build/debug artifacts (`dist/`, `temp/`, `.playwright-mcp/`, `test-results/`).
- **Expanded Smoke Coverage (`tests/smoke.spec.ts`):** Added Playwright smoke tests for Scene 2 Touch-Up Target-MB preservation (`BLEACH -` → PNG 0.05 MB) and `MEME VID` → `GIF Transparent` worker encoding (`TIGHT SUBJECT 50%`, `10 FPS`, `0.50 MB`).

### Fixed
- **Touch-Up Target-MB Preservation (`src/services/mediaPipeline.ts`, `src/components/TouchUpBrush.tsx`, `src/components/DryingLineScene.tsx`, `src/App.tsx`):** Touch-up commits on `spin`/`both` image cycles now re-run `reencodeImageCanvas` (including worker PNG palette/scale quantization) with monotonic stale-commit guarding, update `width`/`height` on the Care Tag receipt, and keep armed `<canvas>` dimensions locked so live strokes are never cleared during downscale re-encodes.
- **Spec Alignment (`docs/superpowers/specs/2026-11-17-kilowash-design.md`):** Updated outdated `Xenova/modnet` and non-English format labels to match the `briaai/RMBG-1.4` worker architecture and English UI standard.

## [1.4.0] - 2026-11-17

### Added
- **Scene 2 Spot Stain Touch-Up (`src/components/TouchUpBrush.tsx`, `src/components/DryingLineScene.tsx`):** Added a diegetic tool shelf under the clothesline with **BLEACH `-`** (`destination-out` erase) and **PATCH `+`** (restore clipped from the cropped original) brushes, an 8–64px size dial, a 10-step `ImageBitmap` undo/redo stack, a red/cyan ring cursor tracking the pointer, and a procedural brush hiss (`playBrushHiss`). The hanging garment holds still while armed so pointer→pixel mapping stays exact, and every committed stroke re-encodes the canvas back into the Care Tag receipt (`outputBlob`, `finalSizeMB`, `savedPercent`) so downloads always ship the edited image.
- **Clipboard Integrations (`src/App.tsx`, `src/components/DryingLineScene.tsx`):** `Ctrl/Cmd+V` anywhere outside a text field loads a clipboard image straight into the drum, and **COPY PNG** on the Care Tag writes a transparent PNG to the system clipboard (re-encoding WebP/JPEG outputs first) with `PNG COPIED` / `CLIPBOARD BLOCKED` feedback.

### Changed
- **Large-Input Preview Cap (`src/services/mediaPipeline.ts`):** Drum previews are now encoded at ≤ 480 px (`previewDataUrl`) instead of at the full working resolution. Measured on a 6000×4000 PNG: worst main-thread stall during a WASH cycle dropped from **1009.8 ms to 488 ms** (MessageChannel ping probe), and both 12 MP and 24 MP inputs complete with their resolution preserved (4000×3000 / 6000×4000 output) and no tab crash — page heap peaked at 60 MB and 116 MB. The remaining ~0.5 s is the full-resolution output decode in the drying scene, which any 24 MP viewer pays.
- **Smoke Suite (`playwright.config.ts`, `tests/smoke.spec.ts`, `npm run smoke`):** Added a Playwright suite that builds the project, serves `dist/` on port 5157 and covers two paths. (1) MEME IMG → PNG 0.05 MB: asserts the worker chunk boots in the production bundle, RMBG-1.4 segments, the PNG Target-MB solver lands under budget (PNG magic bytes + size). (2) Offline: with `huggingface.co` / `hf.co` / `jsdelivr.net` aborted, asserts the worker falls through to Sobel (`OFFLINE FALLBACK` status observed), the cycle still completes, and the result has real transparency. Passes in ~39 s + ~12 s warm; the suite is what caught the watchdog firing on a legitimate slow WASM inference.
- **Worker Job Watchdog (`src/services/mediaWorkerClient.ts`, `src/workers/mediaWorker.ts`):** Every worker job arms a 300 s silence timer reset by its progress messages; on expiry the worker is terminated, all pendings are rejected with `Media worker stopped responding for 300s — cycle aborted.`, and the next START respawns it. `ENCODE_PNG` gained a `PNG_PROGRESS` message so long palette descents cannot trip the timer. The window is generous on purpose: the WASM fallback spends ~110 s inside one opaque `await` (session creation + first 1024² inference) on Chromium builds without SIMD/threads. Verified by stubbing the segment handler: abort fires with the expected banner and START re-enables.
- **PNG Target-MB Solver Moved Off-Thread (`src/workers/mediaWorker.ts`, `src/services/mediaWorkerClient.ts`):** The palette/scale descent (`quantize` + `applyPalette` across up to 7 scales × 4 color budgets) now runs as an `ENCODE_PNG` worker job on a transferred `ImageBitmap`, replacing the main-thread `quantizeCanvasForPng`. `gifenc` is no longer imported by the main bundle. Verified: 900×900 → 766×766 PNG at 0.05 MB, 49,535 bytes under a 52,428-byte budget, max main-thread frame gap 71.6 ms.
- **Dedicated Media Worker (`src/workers/mediaWorker.ts`, `src/services/mediaWorkerClient.ts`, `src/types/workerMessages.ts`):** RMBG-1.4 inference, alpha compositing, the Sobel offline fallback, and the complete GIF Target-MB solver now run inside one long-lived ES module worker. Frames and masks cross the thread boundary as transferable `ImageBitmap` / `Float32Array` (zero-copy), the model session loads once per worker, worker crashes are rejected and the worker is respawned on the next job, and `aiBackgroundRemover.ts` became a thin client. A 30-frame video wash + GIF encode now runs with zero main-thread frames over 50 ms (measured max frame gap 31.7 ms).
- **WebGPU Acceleration (`src/workers/mediaWorker.ts`):** The worker probes `navigator.gpu` and loads RMBG-1.4 as `fp16` on the WebGPU execution provider, falling back to the previous WASM `q8` path when no adapter or session is available. A failed WebGPU session is remembered for the worker's lifetime, and the loading readout names the active backend (`WEBGPU FP16` / `WASM Q8`).

### Removed
- **Main-thread GIF encoder:** `encodeTransparentGif` was folded into the worker as `encodeGifAttempt`, so `gifenc` no longer blocks the UI thread and the main bundle dropped from ~1.86 MB to ~975 KB.

## [1.3.0] - 2026-11-17

### Added
- **3D Voxel Creator Spotlight (`src/components/CreatorSpotlight.tsx`):** Added a compact `50×50px` Three.js GLTF voxel operator in the top-right header (`public/models/lee-voxel.glb`) with state-reactive laundry animations (`SHAKING DETERGENT` when idle, `SCRUBBING LOADS` over a mini suds tub during wash, `HIGH-SPEED SPIN CHEER` during spin, and `WAVING CLEAN TOWEL` in Scene 2) plus a Neo-Brutalist creator popover card (`Lee Khan · CREATOR`).

### Fixed
- **Header Layout Stability (`src/App.tsx`, `src/components/ThemeToggle.tsx`):** Locked badge/button widths and single-row desktop header flex rules so toggling `SFX ON/OFF` or `DAY/NIGHT SHIFT` produces zero horizontal or vertical layout shift.

## [1.2.0] - 2026-11-17

### Added
- **Procedural Laundry SFX Engine (`src/utils/laundrySfx.ts`):** Added zero-dependency Web Audio API sound synthesis featuring mechanical switch clicks, heavy rotary dial detents, front-load door latch clunks, stage-synced drum audio loops (water filling, rhythmic washing slosh + motor hum, rinsing drain, rising centrifuge spin), and a 4-note completion chime.
- **Header SFX Toggle (`src/App.tsx`):** Added an `SFX ON` / `SFX OFF` Neo-Brutalist mute button in the top navigation bar.

## [1.1.0] - 2026-11-17

### Added
- **Diegetic Full-Room UI (`src/components/RoomFixtures.tsx`):** Replaced detached side form panels with in-room architectural fixtures — `LaundryBasketFixture` (left floor basket with `MEME IMG` and `MEME VID` tags) and `WallDispenserRackFixture` (wall-mounted Detergent Pods, Digital Target-MB Weight Scale, and Output Drain Valve).
- **Scene 2: Drying Line (`src/components/DryingLineScene.tsx`):** Automatic transition after washing to a clothesline drying room where the final output hangs from two clothespins, sways gently with dripping water animations alongside a Care Tag Receipt, and provides backdrop cloth switchers (`Transparent`, `#00FF00`, `Dark Slate`, `White Linen`), `PEEK BEFORE / AFTER`, and `UNPIN & DOWNLOAD`.
- **Built-in Machine START Button (`src/components/LaundryMachine.tsx`):** Placed a tactile `START` push-button directly on the Model KW-01 front panel alongside the rotary program knob and LED readout.
- **5-Stage Theatrical Cleaning Animation (`src/services/mediaPipeline.ts`):** Added realistic timed stages (`01 // LOCKING DOOR & FILLING WATER`, `02 // DEEP SCRUB & AI STAIN REMOVAL`, `03 // RINSING & DRAINING DIRTY BG`, `04 // HIGH-SPEED SPIN & MB PRESS`, `05 // CYCLE COMPLETE — HANGING TO DRY`) featuring pouring intake water, back-and-forth drum scrubbing, dense soap suds, a cyan AI laser scan bar, and high-speed centrifuge water droplets.
- **Project Documentation:** Added `AGENTS.md`, `README.md`, and `CHANGELOG.md`.

### Changed
- **Upgraded AI Segmentation Model (`src/services/aiBackgroundRemover.ts`):** Switched from portrait-biased `Xenova/modnet` to **`briaai/RMBG-1.4` (`dtype: 'q8'`)** with min-max normalization and Sobel edge-barrier offline fallback, fixing cutouts on general objects such as vehicles, illustrations, and memes.
- **Night Shift Contrast & Readability (`src/index.css`):** Fixed dark-on-dark text issues in Night Mode by enforcing `--ui-text` (`#F8FAFC`), `--ui-muted` (`#CBD5E1`), `--night-rim` panel highlights, and `.text-adaptive` / `.text-on-accent` utility classes.
- **English Standardization:** Unified all UI copy, labels, error messages, format names, tooltips, and HTML language attributes (`<html lang="en">`) to English.

### Removed
- Removed deprecated external form components `ControlDeck.tsx` and `LaundryReceiptCard.tsx` after migrating controls and results directly into the 2.5D room scenes.

## [1.0.0] - 2026-11-17

### Added
- Initial release of **KILOWASH (`KILOWASH // SYS-24H`)** built with React 18, TypeScript, Vite, Tailwind CSS, and Framer Motion.
- Implemented **Palet A: Swiss Coin-Op 24H** (Neo-Brutalism × Swiss Style) with the animated `rishichawda/fluffy-robin-48` Day/Night toggle (`src/components/ThemeToggle.tsx`).
- Implemented client-side **Pre-Treat Focus Crop** and **Video Trim / FPS** controls (`src/components/PreTreatOverlay.tsx`).
- Implemented client-side Target-MB binary-search image compression (`WebP`, `PNG`, `JPEG`) and video/animated-GIF encoders (`gifenc` Transparent GIF, Transparent WebM, and `#00FF00` Green Screen).
- Added built-in procedural meme image and animated meme video generators (`src/utils/sampleMedia.ts`).
