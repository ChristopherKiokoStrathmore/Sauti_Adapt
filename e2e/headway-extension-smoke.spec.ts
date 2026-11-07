import { expect, test, chromium, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Verifies the actual extension bundle loads into Chromium, not merely that the site renders an install button.
// Publication and user approval through the Chrome Web Store are separate external requirements.
test('built Headway extension loads in Chromium and shows its side panel', async () => {
  const root = path.resolve('apps/headway');
  const userData = await mkdtemp(path.join(os.tmpdir(), 'headway-install-smoke-'));
  const context = await chromium.launchPersistentContext(userData, {
    headless: false,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  try {
    let worker = context.serviceWorkers()[0] as Worker | undefined;
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20_000 });
    const extensionId = new URL(worker.url()).hostname;
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/dist/sidepanel.html`);
    await expect(panel).toHaveTitle('Headway');
    await expect(panel.getByRole('heading', { name: 'Your voice' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'AI Browser Agent' })).toBeVisible();
    // Headway Voice is audio-only: the head pointer is deliberately switched off.
    await expect(panel.getByRole('heading', { name: 'Pointer' })).not.toBeVisible();
    await expect(panel.locator('#agent-confirm')).toBeDisabled();
  } finally {
    await context.close();
    await rm(userData, { recursive: true, force: true });
  }
});
