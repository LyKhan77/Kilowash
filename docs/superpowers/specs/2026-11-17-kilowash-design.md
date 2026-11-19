# KILOWASH // SYS-24H — Design & Architecture Specification

**Date:** 2026-11-17  
**App Name:** `KILOWASH` (`KILOWASH // SYS-24H`)  
**Visual Style:** Neo-Brutalism × Swiss Style  
**Color Palette:** Palet A — **SWISS COIN-OP 24H**  
**Room Rendering:** 2.5D Vector/CSS Architectural Room + Framer Motion  
**Day/Night Toggle:** `rishichawda/fluffy-robin-48` SVG Sun/Moon/Clouds/Stars Switch  
**Compute Model:** 100% Client-Side in Browser (Zero Backend)

---

## 1. Visual Identity & Palet A Tokens (Swiss Coin-Op 24H)

| Token | Day Shift (Siang) | Night Shift (Malam) | Usage |
| :--- | :--- | :--- | :--- |
| `--wall` | `#ECE6DC` | `#121A26` | Architectural room tiled wall |
| `--machine-body` | `#FFFDF8` | `#1E293B` | 2.5D washing machine front chassis |
| `--machine-side` | `#E5DFD3` | `#131C2B` | 2.5D top & side extruded chassis |
| `--panel` | `#D8D3C8` | `#0F172A` | Swiss instrument header & outer drum bezel |
| `--wash-accent` | `#00E5FF` | `#00E5FF` | Wash Cycle (AI Background Removal) |
| `--spin-accent` | `#FF5416` | `#FF5416` | Spin Cycle (Target MB Compression) |
| `--both-accent` | `#FFE600` | `#FFE600` | Wash + Spin Full Cycle |
| `--ink` | `#111111` | `#090D16` | Thick 3px–4px Neo-Brutalist borders & hard shadows |

- **Typography:**
  - Display / Headers / Controls: `Space Grotesk` (700, 800)
  - Technical Telemetry / Target MB / Receipts: `JetBrains Mono` (500, 700)

---

## 2. 2.5D Architectural Room & Laundromat Experience

1. **Environmental Room Stage:**
   - Swiss architectural grid-tiled wall, industrial overhead pipe with clamps, perspective tiled floor with dynamic light reflection under the machine.
   - Left window showing animated clouds & sun with diagonal sunbeams during **Day Shift**, transitioning smoothly into twinkling stars, crescent moon, and glowing **KILOWASH // OPEN 24H** neon signage & drum glow during **Night Shift**.
2. **Centerpiece 2.5D Machine (`MODEL KW-01`):**
   - Skewed top/right depth extrusions, Swiss instrument header with LED status screen, rotary program knob, and 3 status lamps.
   - Circular glass drum door that responds to drag-and-drop, houses the interactive **Pre-Treat Focus Crop & Video Trim Overlay**, and locks shut during cycles with rotating drum ribs, sloshing SVG detergent waves, rising bubbles, live processed frame previews, and Framer Motion centrifuge vibration.

---

## 3. Client-Side AI & Target-MB Media Pipeline

### A. AI Background Removal (`src/workers/mediaWorker.ts`, `src/services/aiBackgroundRemover.ts`)
- Powered by `@huggingface/transformers` running **`briaai/RMBG-1.4`** directly in the browser inside a dedicated Web Worker (`WebGPU fp16` when an adapter is available, falling back to `WASM q8`) with progress callbacks.
- Includes **Temporal Alpha Smoothing** (`smoothed = 0.82 * current + 0.18 * prev`) across consecutive video frames to suppress boundary flicker on GIFs and memes.
- Includes a resilient **Sobel Edge-Barrier Salient Segmentation Fallback** inside the worker so wash operations still complete cleanly even if offline or model download is unavailable.

### B. Target-MB Compression & Encoders (`src/services/mediaPipeline.ts`, `src/workers/mediaWorker.ts`)
- **Images (`WebP`, `PNG`, `JPEG`):**
  - Binary searches lossy `quality` (`0.04`–`0.96`) over 7 iterations, then scales dimensions adaptively if needed until `blob.size <= targetBytes`.
  - For PNG when Spin is active, applies off-thread palette quantization (`gifenc` quantize) + adaptive downscaling in `mediaWorker.ts` to meet target MB while preserving transparency.
- **Videos & Memes (`GIF Transparent`, `WebM Transparent`, `Video Green Screen #00FF00`):**
  - Extracts cropped frames at `10`, `12`, or `15 FPS` (max 8s clip window for client memory safety).
  - **Transparent GIF:** Encodes off-thread via `gifenc` with magenta transparency key `[255, 0, 255]`, iteratively adjusting palette color budget (`256 -> 128 -> 64 -> 32`) and resolution if Spin compression exceeds Target MB.
  - **Transparent WebM / Green Screen:** Calculates target video bitrate from `targetMB` and clip duration, renders to offscreen canvas (`transparent` or `#00FF00`), records via `MediaRecorder` (`VP9` / `WebM`), and downscales dimensions if needed to satisfy `targetMB`.
