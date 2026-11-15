import { defineConfig } from '@playwright/test'

const baseURL = process.env.SAATHICARE_TEST_URL || 'http://127.0.0.1:3100'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: process.env.SAATHICARE_TEST_URL ? 'test-results/cloud' : 'test-results/local',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  use: { baseURL, contextOptions: { reducedMotion: 'reduce' }, trace: 'retain-on-failure', launchOptions: { executablePath } },
  webServer: process.env.SAATHICARE_TEST_URL ? undefined : {
    command: 'npm run dev -- --webpack --hostname 127.0.0.1 --port 3100', url: baseURL, timeout: 120_000, reuseExistingServer: !process.env.CI,
  },
})
