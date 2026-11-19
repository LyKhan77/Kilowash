# KILOWASH // HANGER STUDIO — Design Specification

**Date:** 2026-11-19  
**Feature:** `HANGER STUDIO // EXPORT FX` (Scene 2 Baked Backdrop, Drop Shadow & Die-Cut Sticker Outline)  
**Scope:** Image outputs in Scene 2 (`DryingLineScene`). Video/GIF outputs remain unaffected.  
**Visual Style:** Neo-Brutalism × Swiss Style (Palet A — Swiss Coin-Op 24H, Day & Night Shifts)  
**Compute Model:** 100% Client-Side Canvas 2D Compositing + Target-MB Re-Encoder (`reencodeImageCanvas`)

---

## 1. Problem & Goal

Currently, the `BACKDROP:` buttons on Scene 2's floor bar only tint the CSS preview box behind a transparent cutout—they do **not** appear in the downloaded or clipboard-copied file. E-commerce sellers and sticker creators need to export ready-to-use images with:
1. **Solid Marketplace / Brand Backdrops** (`NONE`, `WHITE`, `SLATE`, `#00FF00`, or custom hex color) baked directly into the exported file.
2. **Soft Contact / Drop Shadow** (`SHADOW`) to give isolated subjects realistic depth.
3. **Die-Cut Sticker Outline** (`STICKER` with `THIN | MED | BOLD` border) for WhatsApp/Telegram/Discord stickers and meme cutouts.

---

## 2. Single Source of Truth & Non-Destructive Architecture

- **Non-destructive base buffer:** `DryingLineScene` tracks the clean pre-FX image (`baseImageUrl`, reset only when a new `receipt` cycle completes or when `TouchUpBrush` commits a stroke). Changing `HANGER STUDIO` controls always re-renders from `baseImageUrl`, preventing stacked shadows or bloated repeated outlines.
- **Single source of truth:** Every `HANGER STUDIO` change composites offscreen via `renderHangerStudioBlob()` in `src/services/hangerStudio.ts`, re-encodes via `reencodeImageCanvas()` (enforcing `receipt.targetMB` when `receipt.enforcedTargetMB` is true), and updates the active `receipt` through `onOutputEdited(blob, width, height)`.
- **Auto-padding:** When `dropShadow` or `stickerOutline` is active, the output canvas expands symmetrically with safe transparent padding so outlines and shadows never clip at the image border.

---

## 3. Diegetic UI (`src/components/DryingLineScene.tsx`)

Right below `TouchUpShelf` (when `receipt.mediaKind === 'image'`), render a matching Neo-Brutalist shelf **`HANGER STUDIO // EXPORT FX`**:
- **Export Backdrop:** `NONE` (transparent), `WHITE` (`#FFFFFF`), `SLATE` (`#0F172A`), `#00FF00`, and compact color picker (`CUSTOM`).
- **Effect Toggles:**
  - `SHADOW` toggle button (soft drop shadow).
  - `STICKER` toggle button (crisp white die-cut outline) + width selector (`S | M | L`) when active.
  - `RESET FX` button when any effect is active.
- **Compatibility:**
  - `TouchUpBrush` (`BLEACH -` / `PATCH +`) continues to operate cleanly; when `TouchUpBrush` commits an edit while FX are active, FX automatically re-render onto the edited cutout, or users can toggle FX at any time without losing the base cutout.
  - Works seamlessly across Day Shift and Night Shift (`--ui-card`, `--ui-text`, `--active-accent`, `--ink`).
