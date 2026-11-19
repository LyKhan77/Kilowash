# HANGER STUDIO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `HANGER STUDIO // EXPORT FX` in Scene 2 (`DryingLineScene`) so users can bake solid backdrops, soft drop shadows, and die-cut white sticker outlines into their downloaded/copied image while honoring Target-MB budgets.

**Architecture:** Isolate Canvas 2D padding, radial silhouette dilation (sticker border), drop shadow rendering, and solid backdrop compositing inside `src/services/hangerStudio.ts`, then re-encode through `reencodeImageCanvas` and update the single-source-of-truth receipt in `DryingLineScene.tsx`.

**Tech Stack:** React 18, TypeScript, HTML5 Canvas 2D, `reencodeImageCanvas`, Playwright.

---

### Task 1: Create `src/services/hangerStudio.ts`

**Files:**
- Create: `src/services/hangerStudio.ts`

- [ ] **Step 1: Write `src/services/hangerStudio.ts` with `HangerStudioOptions` and `renderHangerStudioImage`**

```ts
import { reencodeImageCanvas } from './mediaPipeline';
import type { ImageOutputFormat } from '../types/laundry';

export type ExportBackdropMode = 'none' | 'white' | 'slate' | 'greenscreen' | 'custom';
export type StickerThickness = 'sm' | 'md' | 'lg';

export interface HangerStudioOptions {
  backdrop: ExportBackdropMode;
  customColor: string;
  dropShadow: boolean;
  stickerOutline: boolean;
  stickerSize: StickerThickness;
}

export const DEFAULT_HANGER_STUDIO: HangerStudioOptions = {
  backdrop: 'none',
  customColor: '#FFE600',
  dropShadow: false,
  stickerOutline: false,
  stickerSize: 'md',
};

export function hasActiveHangerFx(opts: HangerStudioOptions): boolean {
  return opts.backdrop !== 'none' || opts.dropShadow || opts.stickerOutline;
}
```

Implement `renderHangerStudioImage(params)` loading `baseUrl`, creating an offscreen padded canvas (`outlinePx` + `shadowPad`), building a white silhouette via `source-in` for the radial 20-step die-cut sticker outline, drawing `dropShadow` via Canvas shadow props, filling solid backdrop behind via `destination-over`, and returning `reencodeImageCanvas(...)`.

---

### Task 2: Integrate `HANGER STUDIO // EXPORT FX` Shelf into `DryingLineScene.tsx`

**Files:**
- Modify: `src/components/DryingLineScene.tsx`

- [ ] **Step 1: Track `baseUrlRef` / `baseKeyRef` so Hanger Studio always composites non-destructively from the clean cutout (and updates base when `TouchUpBrush` commits).**
- [ ] **Step 2: Render `HANGER STUDIO // EXPORT FX` diegetic shelf with `NONE | WHITE | SLATE | #00FF00 | COLOR`, `SHADOW`, `STICKER (S|M|L)`, and `RESET` controls.**
- [ ] **Step 3: Run `npm run build` and verify clean compilation.**

---

### Task 3: Add Playwright Smoke Test & Verify Day/Night Shifts

**Files:**
- Modify: `tests/smoke.spec.ts`

- [ ] **Step 1: Add smoke test verifying `WASH` → Scene 2 → enabling `STICKER` + `SHADOW` + `WHITE` backdrop updates `RESOLUTION` (due to safe padding) and produces a valid non-transparent PNG/WebP output.**
- [ ] **Step 2: Run `npm run build` and `npm run smoke` and verify all tests pass.**
