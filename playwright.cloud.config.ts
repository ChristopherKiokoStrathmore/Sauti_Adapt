import { defineConfig } from '@playwright/test';

const baseURL = process.env.SAUTI_LIVE_WEB_URL?.trim();
if (!baseURL || !/^https:\/\//i.test(baseURL)) {
  throw new Error('Set SAUTI_LIVE_WEB_URL to the HTTPS address of the deployed Vercel app.');
}

// Deliberately no webServer: these tests access the real deployed endpoints.
// The ordinary playwright.config.ts MUST remain mock and deterministic.
export default defineConfig({
  testDir: './cloud-e2e',
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
