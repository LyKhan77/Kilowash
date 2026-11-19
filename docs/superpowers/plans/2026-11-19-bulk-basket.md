# BULK BASKET Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable multi-image batch processing (up to 12 images) in `LaundryBasketFixture` / `LaundryMachine`, sequential execution in `App.tsx`, item switching & per-item editing in `DryingLineScene`, and zero-dependency client-side `.zip` export.

**Architecture:** Implement a pure-TypeScript PKZIP (`STORE` + CRC-32) archive builder in `src/utils/zipBuilder.ts`, upgrade `LaundryBasketFixture` and `LaundryMachine` for multi-file selection/drop, track `bulkQueue` and `bulkReceipts` in `App.tsx`, and render a Scene 2 garment switcher + `DOWNLOAD ALL (.ZIP)` button in `DryingLineScene.tsx`.

**Tech Stack:** React 18, TypeScript, Web `Blob`/`Uint8Array` PKZIP builder, Playwright.

---

### Task 1: Create `src/utils/zipBuilder.ts`
- Implement `crc32(bytes)` and `buildZipBlob(entries: Array<{ name: string; blob: Blob }>)` producing a valid standard `.zip` Blob (`PK\x03\x04` local headers, `PK\x01\x02` central directory, `PK\x05\x06` EOCD) with deduplicated filenames.

### Task 2: Multi-File Basket & Drum Support (`RoomFixtures.tsx`, `LaundryMachine.tsx`, `App.tsx`)
- Add `multiple` file input and `onFilesSelected` / `onFilesDropped` handlers.
- Track `bulkQueue: LoadedMedia[]` and `bulkReceipts: LaundryReceipt[]` in `App.tsx`, running sequential `processImageLaundry` with `BATCH i/N` progress updates and full object URL cleanup.

### Task 3: Scene 2 Batch Garment Strip & `.ZIP` Export (`DryingLineScene.tsx`)
- Render item switcher strip when `bulkReceipts.length > 1`, route edits (`onOutputEdited`) to the selected receipt index, and add `DOWNLOAD ALL (.ZIP)` button.

### Task 4: Smoke Test, Visual Day/Night Verification, Commit & Merge to `main`
- Add Playwright batch smoke test (multi-file upload → `SPIN MB` → Scene 2 item switcher → `.zip` magic signature `PK\x03\x04` verification).
- Run `npm run build` and `npm run smoke` (8/8 tests) + visual check on Day/Night shifts.
- Commit & push `feat/bulk-basket`, then merge into `main` and push `origin main`.
