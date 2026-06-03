import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
