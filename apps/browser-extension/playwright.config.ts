import { defineConfig } from '@playwright/test';

export default defineConfig({
  fullyParallel: false,
  reporter: 'list',
  testDir: './test/extension',
  testMatch: '**/*.pw.ts',
  timeout: 90_000,
  use: {
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  workers: 1,
});
