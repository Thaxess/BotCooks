import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run the real dashboard and worker against PGlite and a fake Discord API
 * (see e2e/stack.ts). Set PLAYWRIGHT_CHANNEL to use an installed browser (default: msedge on
 * Windows, otherwise Playwright's bundled Chromium: `npx playwright install chromium`).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx e2e/stack.ts',
    url: 'http://localhost:3100/login',
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
