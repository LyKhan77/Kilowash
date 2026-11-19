# KILOWASH // BULK BASKET — Design Specification

**Date:** 2026-11-19  
**Feature:** `BULK BASKET` (Multi-Image Queue, Sequential Worker Processing & Client-Side `.ZIP` Export)  
**Scope:** Up to 12 images per batch across `WASH`, `SPIN`, `BOTH`, and `CLARIFY` cycles. Single-file image & video flows remain unchanged.  
**Visual Style:** Neo-Brutalism × Swiss Style (Palet A — Swiss Coin-Op 24H)  
**Compute Model:** 100% Client-Side Sequential Pipeline + Zero-Dependency PKZIP (`STORE` + CRC-32) Builder

---

## 1. User Flow & Diegetic UI

1. **Scene 1 — `LaundryBasketFixture` & Drum Multi-Drop:**
   - Basket file input accepts `multiple` files (`accept="image/*,video/*"`). Drum drop zone also accepts multiple dropped files.
   - Selecting 2+ files filters to image files (capped at 12 files for browser memory safety) and shows a stacked **Basket Queue Card** inside `LaundryBasketFixture` (`N ITEMS QUEUED` + clickable/removable chips).
   - Selecting 1 file keeps the existing single-file experience intact.
2. **Sequential Batch Processing (`App.tsx`):**
   - Pressing `START` runs `processImageLaundry` sequentially for each queued image (`1/N .. N/N`), reporting weighted progress (`BATCH i/N // ...`) to the machine LED and drum preview.
   - Stores `bulkReceipts: LaundryReceipt[]` (and revokes all `outputUrl` / `beforeUrl` handles on reset/unmount).
3. **Scene 2 — Clothesline Garment Strip & `.ZIP` Download (`DryingLineScene.tsx`):**
   - When `bulkReceipts.length > 1`, a horizontal **Garment Strip** lets the user switch between any processed item (`#1 .. #N`), inspect its Care Tag, use Compare Slider / Loupe / Touch-Up Brush / Hanger Studio FX on that item, and persist edits back into `bulkReceipts[activeIndex]`.
   - Adds **`DOWNLOAD ALL (.ZIP)`** button generating `kilowash-batch-<N>.zip` client-side via `src/utils/zipBuilder.ts` using standard PKZIP (`STORE` method 0 + IEEE 802.3 CRC-32) — zero external dependencies, instant packaging for already-compressed PNG/WebP/JPEG outputs.
