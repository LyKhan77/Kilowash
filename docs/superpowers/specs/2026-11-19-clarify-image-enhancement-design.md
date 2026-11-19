# KILOWASH // CLARIFY Image Enhancement — Design Specification

**Date:** 2026-11-19  
**Feature:** `CLARIFY` (4th Detergent Pod — Client-Side Image Enhancement & Super-Resolution)  
**Scope:** Images only (PNG, JPEG, WebP, static GIF). Video/animated GIF remains on `WASH`, `SPIN`, `BOTH`.  
**Visual Style:** Neo-Brutalism × Swiss Style (Palet A — Swiss Coin-Op 24H, Day & Night Shifts)  
**Compute Model:** 100% Client-Side in Browser (`mediaWorker.ts` WebGPU/WASM + OffscreenCanvas DSP fallback, Zero Backend, Vercel-Safe)

---

## 1. Goals & User Value

1. **Make blurry, low-res, or heavily cropped images crisp and clear** inside KILOWASH without uploading anything to a server.
2. **Stay faithful to the 2.5D Laundromat metaphor:** Enhancement lives as a 4th pod (`CLARIFY`) inside `01 // DETERGENT PODS` rather than a detached SaaS sidebar.
3. **Composable pipeline (`CLARIFY` → `WASH` → `SPIN`):** Users can run `CLARIFY` alone, combine it with AI Background Removal (`+ BG AI`), and/or combine it with Target-MB Compression (`+ TARGET MB`). When Target-MB is active, enhancement runs *first* and the Target-MB solver enforces the byte budget at the end.
4. **Mobile-scalable & resilient:** Uses tiled inference + feathered cosine seam blending for AI 4× Super-Resolution (`CoderViking/realesr-general-x4v3-onnx` via `onnxruntime-web`, ~4.8 MB) and automatically switches to instant 0-MB `STEAM` DSP enhancement when offline or large non-WebGPU input risks OOM.
5. **Visual verification in Scene 2:** Adds an interactive **Before / After Compare Slider** with a **`LOUPE: FIT | 2X | 4X`** zoom bar on the drying line whenever `CLARIFY` was part of the cycle.

---

## 2. Visual Identity & Diegetic UI Architecture

### A. Cycle Accent Token
| Token | Day Shift | Night Shift | Usage |
| :--- | :--- | :--- | :--- |
| `--clarify-accent` | `#22C55E` | `#22C55E` | `CLARIFY` pod, machine lamp, LED readout, drying glow |

- Text rendered on `--clarify-accent` (`#22C55E`) uses `#111111` (`.text-on-accent`) for high Neo-Brutalist contrast.
- `CreatorSpotlight.tsx` maps `clarify` to `0x22c55e`.

### B. Unit `01 // DETERGENT PODS` (`src/components/RoomFixtures.tsx`)
- Layout changes from `grid-cols-3` to a balanced **`grid-cols-2`** (2×2 pod grid):
  1. `WASH` (`BG AI`, `--wash-accent`)
  2. `SPIN` (`MB`, `--spin-accent`)
  3. `BOTH` (`FULL`, `--both-accent`)
  4. `CLARIFY` (`HD 2X`, `--clarify-accent`, disabled automatically when loaded media is `video` with `IMG ONLY` sub-label)
- When `cycle === 'clarify'`, a compact diegetic sub-panel renders inside Unit 01:
  - **Engine Mode Switch (`AUTO` | `STEAM` | `AI 2X`):**
    - `AUTO` (default): Chooses `AI 2X` when online and image dimensions fit the device budget; otherwise runs `STEAM` DSP.
    - `STEAM`: Instant 0-MB DSP denoise + unsharp sharpen + contrast/vibrance polish.
    - `AI 2X`: Forces tiled Swin2SR 2× super-resolution (with safe input cap + automatic `STEAM` fallback if model download/GPU fails).
  - **Combine Toggles:**
    - `+ BG AI` (`withWash`: runs `RMBG-1.4` after `CLARIFY`).
    - `+ TARGET MB` (`withSpin`: activates `02 // WEIGHT SCALE (MB)` and runs Target-MB compression after `CLARIFY`/`WASH`).

### C. Washer Chassis (`src/components/LaundryMachine.tsx`)
- **4 Status Lamps:** `wash`, `spin`, `both`, `clarify`.
- **Rotary Program Dial:** Rotates across 4 detents (`-52deg`, `-18deg`, `+18deg`, `+52deg`) and cycles `'wash' -> 'spin' -> 'both' -> 'clarify'` (skipping `'clarify'` if loaded media is `video`).
- **Idle LED Readout:** Shows `CLARIFY // AUTO (+BG)? (TARGET MB | FORMAT)`.
- **Drum Animation & Audio:** `'clarifying'` progress phase maps to the `'wash'` drum agitation animation and `'wash'` procedural SFX loop in `src/utils/laundrySfx.ts`.

---

## 3. Client-Side Enhancement & Pipeline Architecture

### A. Pipeline Ordering (`src/services/mediaPipeline.ts`)
For `media.kind === 'image'`:
1. **Stage 1 (`filling`):** Crop source image to `workingCanvas` via `cropSourceToCanvas`. Capture a cropped `beforePreviewBlob` / `beforeUrl` (`preClarifyUrl`) before processing so Scene 2's Compare Slider aligns pixel-for-pixel with the cropped region.
2. **Stage 2 (`clarifying`, when `cycle === 'clarify'`):**
   - Run `clarifyCanvas(workingCanvas, clarifyOptions, onProgress)` via `mediaWorkerClient.ts` -> `mediaWorker.ts`.
   - Output replaces `workingCanvas` (same dimensions for `STEAM`; `2×` upscaled dimensions for `AI 2X`).
3. **Stage 3 (`loading-model` -> `washing` -> `rinsing`, when `cycle === 'wash' || cycle === 'both' || (cycle === 'clarify' && clarify.withWash)`):**
   - Run `removeBackgroundFromCanvas(workingCanvas, ...)` on the clarified image so `RMBG-1.4` receives crisp edges.
4. **Stage 4 (`spinning`, when `cycle === 'spin' || cycle === 'both' || (cycle === 'clarify' && clarify.withSpin)`):**
   - Run `compressCanvasToTargetMB(workingCanvas, outputFormat, targetMB, ...)` so the final artifact strictly satisfies the Target-MB budget. Otherwise run `encodeCanvasDirect`.

### B. Dual-Tier Worker Engine (`src/workers/mediaWorker.ts`)

#### Tier 1: `AI 4X` (`realesr-general-x4v3` via `onnxruntime-web`)
- Fetched on-demand from Hugging Face CDN (~4.8 MB) and cached in the browser Cache API (`kilowash-clarify-onnx-v1`), then executed inside `mediaWorker.ts` (`WebGPU` first, remembering WebGPU rejection and falling back to `WASM`).
- **Mobile & VRAM Scalability:**
  - **Input Guardrail:** Before tiling, if `mode === 'auto'` and either `navigator.onLine === false`, or input longest side exceeds `MAX_AUTO_AI_DIM` (`512px` mobile / `768px` desktop with WebGPU; `360px` on WASM), `AUTO` routes cleanly to `STEAM` DSP. Users can explicitly choose `AI 4X` to run tiled Real-ESRGAN (clamped to `512px` mobile / `768px` desktop max input so 4× output never exceeds `2048px` / `3072px`).
  - **Tiled Inference + Feathered Cosine Seam Blending:**
    - Tile size `128×128`, overlap `12px` (`stride = 104px`), 4× output per tile (`512×512`).
    - Tiles are accumulated into `Float32Array` RGB + weight buffers using a raised-cosine 2D feather mask so tile seams are invisible, and intermediate tensors are disposed per tile.
    - Worker posts `CLARIFY_PROGRESS` after each tile (`REAL-ESRGAN 4X // TILE i/N`) so `mediaWorkerClient.ts` resets its silence timer and updates the drum LED.
  - **Resilience:** Any network block, model load failure, or inference error automatically falls back to `STEAM` DSP inside the worker instead of failing the user's laundry cycle.

#### Tier 2: `STEAM` DSP (`runSteamDspEnhance` in `mediaWorker.ts`)
- Pure pixel math on `OffscreenCanvas` `ImageData` (zero network, zero model download, <150 ms):
  1. **Light edge-preserving smoothing (3×3 luminance-aware bilateral filter, `sigmaRange = 16`):** Reduces JPEG block noise without smearing crisp edges.
  2. **Crisp Unsharp Mask (radius-1 Gaussian blur subtraction, `amount = 1.05`, threshold `2`):** Pops fine detail and text cleanly.
  3. **Adaptive micro-contrast & saturation lift (`1.09` / `1.08`):** Restores punch while clamping `[0, 255]` and preserving alpha channel untouched.

---

## 4. Scene 2: Compare Slider, Touch-Up Brush & Care Tag (`src/components/DryingLineScene.tsx`)

1. **Before / After Compare Slider:**
   - Enabled automatically when `receipt.clarifyBackend` is present (`receipt.beforeUrl` available) and `brush.armed` is false and `showBefore` is false.
   - Renders a draggable vertical divider handle (`0%..100%`, default `50%`) over the hanging sheet (`clip-path: inset(0 ${100 - split}% 0 0)` for the `BEFORE` layer over the `AFTER` layer, with `object-contain` inside identical bounds and `BEFORE` / `CLARIFY` corner badges).
   - Supports pointer drag, touch drag, and keyboard `ArrowLeft`/`ArrowRight` on the range/handle for accessibility.
2. **Touch-Up Brush Compatibility:**
   - Remains available when `WASH` ran (`cycle === 'wash' || cycle === 'both' || receipt.hasTransparency`), and hides/disables cleanly with a clear note when `CLARIFY` ran without `BG AI`.
3. **Care Tag Receipt Metadata:**
   - Displays `ENHANCE` row (`AI 2X (WEBGPU)` / `AI 2X (WASM)` / `STEAM DSP`) when `receipt.clarifyBackend` is set.
   - `TARGET MB` displays `N/A (CLARIFY ONLY)` or `N/A (WASH ONLY)` when Spin is inactive, and `<= X.XX MB` when `+ TARGET MB` is active.

---

## 5. Verification Plan

1. **Build & Type Check:** `npm run build` (`tsc && vite build`) passes cleanly with zero errors.
2. **Playwright Smoke Suite (`tests/smoke.spec.ts`):**
   - Existing 4 tests pass unchanged.
   - Add deterministic smoke test for **`CLARIFY` (`STEAM` + `+ TARGET MB` PNG / WebP)** and **offline `AUTO` fallback to `STEAM`** asserting:
     - `CLARIFY` pod activates sub-toggles (`+ BG AI`, `+ TARGET MB`, `AUTO | STEAM | AI 2X`).
     - Scene 2 renders the `CARE TAG // RECEIPT` with `ENHANCE` metadata and the draggable Before / After Compare Slider.
     - Combining `CLARIFY` + `+ TARGET MB` lands strictly under the requested Target-MB budget.
   - Verify Day Shift and Night Shift visually in Playwright/browser across Scene 1 and Scene 2.
