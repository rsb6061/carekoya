import { defineConfig, devices } from '@playwright/test';
// @ts-expect-error plain JS fixtures shared with prepare.mjs
import { BASE, PORT } from './fixtures.mjs';

// The click-through test (npm run test:e2e): the built site and real Worker on a local database, driven in Chromium.
export default defineConfig({
  testDir: '.',
  timeout: 45000,
  expect: { timeout: 10000 },
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]] : 'list',
  use: { baseURL: BASE, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: '../test-results',
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Phone width for the flows most visitors start on.
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone/ },
  ],
  webServer: {
    command: `npx wrangler dev --config e2e/wrangler.e2e.jsonc --persist-to .wrangler/e2e --port ${PORT} --ip localhost --log-level warn`,
    cwd: '..',
    url: BASE + '/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
  },
});
