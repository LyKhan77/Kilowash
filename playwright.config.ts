import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke suite for the shipped bundle: the webServer builds the project and serves
 * `dist/` through `vite preview` on its own port, so a stale dev server on 5156
 * can never mask a broken production build (worker chunk, wasm asset paths).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 420_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5157',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 5157 --strictPort',
    url: 'http://localhost:5157',
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
