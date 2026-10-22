import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 45_000,
  expect: { timeout: 10_000 }, reporter: [['list'], ['html', { open: 'never' }]],
  webServer: { command: 'node tests/fixture-server.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
  use: { trace: 'retain-on-failure' },
});
