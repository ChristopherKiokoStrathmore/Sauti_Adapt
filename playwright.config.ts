import { defineConfig } from '@playwright/test';
import { ACCESS_CODE, API_PORT, API_TOKEN, API_URL, WEB_PORT, WEB_URL } from './e2e/env';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: WEB_URL,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: [
    {
      command: `python -m uvicorn sauti_ml.api:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: 'services/speech-api',
      env: {
        SPEECH_MODE: 'mock',
        SAUTI_API_TOKEN: API_TOKEN,
        ALLOW_ENROLLMENT: 'false',
        SAUTI_PRIVATE_DIR: '/tmp/sauti-e2e-private',
      },
      url: `${API_URL}/health`,
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -- --port ${WEB_PORT}`,
      cwd: 'apps/web',
      env: {
        DEMO_ACCESS_CODE: ACCESS_CODE,
        SPEECH_API_URL: API_URL,
        SPEECH_API_TOKEN: API_TOKEN,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      url: WEB_URL,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
