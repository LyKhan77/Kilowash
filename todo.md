# Active Task List — KILOWASH // SYS-24H

> **Rule:** This file tracks only the tasks currently being worked on by the agent. Overwrite this file completely whenever previous tasks are completed and a new task batch begins (see `AGENTS.md`).

- [x] **Audit Vercel Readiness:** Check static build output (`dist/`), SPA routing, WASM/Web Worker headers & MIME handling, asset paths (`/models/lee-voxel.glb`), and Vercel config needs.
- [x] **Add Vercel Config (if needed):** Create/verify `vercel.json` (or fix any deployment issues found) and verify with `npm run build`.
- [x] **Initialize Git Repository:** Run `git init`, configure remote `origin` (`https://github.com/LyKhan77/Kilowash.git`), verify `.gitignore` exclusions, and check remote/commit readiness.
