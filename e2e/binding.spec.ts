import { expect, test, chromium, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { USER_ID, USER_TOKEN } from './env';

const extensionPath = path.resolve('apps/extension/dist');
const acceptedScroll = { status: 'accepted', intent: 'SCROLL_DOWN', language: 'en-KE', confidence: 0.91, model_version: 'fixture', reason: null };
const acceptedRead = { status: 'accepted', intent: 'READ_PAGE', language: 'en-KE', confidence: 0.91, model_version: 'fixture', reason: null };
const rejected = { status: 'rejected', intent: 'UNKNOWN', language: null, confidence: 0.1, model_version: 'fixture', reason: 'UNCERTAIN_OR_UNKNOWN' };

function startSites(): Promise<ChildProcess> {
  const child = spawn(process.execPath, [path.resolve('e2e/extension-sites.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture sites did not start')), 10000);
    child.once('error', reject);
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
  });
}

async function scrollTop(page: Page): Promise<number> {
  return page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
}

async function withPanel(run: (pages: { alpha: Page; beta: Page; panel: Page }) => Promise<void>) {
  const sites = await startSites();
  const userData = await mkdtemp(path.join(os.tmpdir(), 'sauti-bind-'));
  const context = await chromium.launchPersistentContext(userData, {
    headless: false,
    viewport: { width: 1100, height: 700 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] as Worker | undefined
      ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;
    const alpha = await context.newPage();
    await alpha.goto('http://127.0.0.1:3000/', { timeout: 15000 });
    const beta = await context.newPage();
    await beta.goto('http://localhost:3000/', { timeout: 15000 });
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { timeout: 15000 });
    const alphaId = await tabId(panel, 'http://127.0.0.1:3000/');
    await press(panel, alphaId, 'grant');
    await expect(panel.locator('#status')).toContainText('Enabled http://127.0.0.1:3000');
    await panel.locator('#user').fill(USER_ID);
    await panel.locator('#code').fill(USER_TOKEN);
    await panel.locator('#profile').fill('11111111-1111-4111-8111-111111111111');
    await run({ alpha, beta, panel });
  } finally {
    await context.close();
    sites.kill();
    await rm(userData, { recursive: true, force: true });
  }
}

test('switching tabs during inference does not scroll the new tab', async () => {
  test.setTimeout(60_000);
  await withPanel(async ({ alpha, beta, panel }) => {
    await arm(panel, acceptedScroll);
    await listen(panel);
    await beta.bringToFront();
    const betaBefore = await scrollTop(beta);
    await release(panel);
    await expect(panel.locator('#status')).toContainText('Scrolling down.');
    await expect.poll(() => scrollTop(alpha)).toBeGreaterThan(0);
    expect(await scrollTop(beta)).toBe(betaBefore);
  });
});

test('navigating during inference does not run the command', async () => {
  test.setTimeout(60_000);
  await withPanel(async ({ alpha, panel }) => {
    await arm(panel, acceptedScroll);
    await listen(panel);
    await alpha.goto('http://127.0.0.1:3000/?left=1', { timeout: 15000 });
    await release(panel);
    await expect(panel.locator('#status')).toContainText('page changed');
    expect(await scrollTop(alpha)).toBe(0);
  });
});

test('revoking the origin during inference does not run the command', async () => {
  test.setTimeout(60_000);
  await withPanel(async ({ alpha, panel }) => {
    const alphaId = await tabId(panel, 'http://127.0.0.1:3000/');
    await arm(panel, acceptedScroll);
    await listen(panel);
    const before = await scrollTop(alpha);
    await press(panel, alphaId, 'disable');
    await release(panel);
    await expect(panel.locator('#status')).not.toContainText('Scrolling down');
    expect(await scrollTop(alpha)).toBeLessThanOrEqual(before + 1);
  });
});

test('clearing the token during inference does not run the command', async () => {
  test.setTimeout(60_000);
  await withPanel(async ({ alpha, panel }) => {
    await arm(panel, acceptedScroll);
    await listen(panel);
    const before = await scrollTop(alpha);
    await panel.locator('#code').fill('');
    await release(panel);
    await expect(panel.locator('#status')).toContainText('Sign-in changed');
    expect(await scrollTop(alpha)).toBeLessThanOrEqual(before + 1);
  });
});

test('read this from the controller is spoken', async () => {
  test.setTimeout(60_000);
  await withPanel(async ({ panel }) => {
    await arm(panel, acceptedRead);
    await listen(panel);
    await release(panel);
    await expect.poll(() => spoken(panel)).toContain('ALPHA-SITE');
  });
});

test('rejected speech is not spoken', async () => {
  test.setTimeout(60_000);
  await withPanel(async ({ panel }) => {
    await arm(panel, rejected);
    await listen(panel);
    await release(panel);
    await expect(panel.locator('#status')).toContainText('Nothing was spoken');
    expect(await spoken(panel)).toBe('');
  });
});

async function tabId(panel: Page, prefix: string): Promise<number> {
  const id = await panel.evaluate(async (start: string) => {
    const api = (globalThis as unknown as { chrome: { tabs: { query: (q: object) => Promise<{ id?: number; url?: string }[]> } } }).chrome;
    const tabs = await api.tabs.query({});
    return tabs.find((tab) => tab.url?.startsWith(start))?.id ?? 0;
  }, prefix);
  expect(id).toBeGreaterThan(0);
  return id;
}

async function press(panel: Page, tab: number, buttonId: string) {
  await panel.evaluate(async ({ tab, buttonId }) => {
    const api = (globalThis as unknown as { chrome: { tabs: { update: (id: number, props: { active: boolean }) => Promise<unknown> } } }).chrome;
    await api.tabs.update(tab, { active: true });
    document.getElementById(buttonId)?.click();
  }, { tab, buttonId });
}

async function arm(panel: Page, payload: object) {
  await panel.evaluate(async (body) => {
    const slot = window as Window & { __release?: () => void; __spoken: string[] };
    slot.__spoken = [];
    window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => { slot.__spoken.push(utterance.text); };
    const audio = new AudioContext();
    await audio.resume();
    const dest = audio.createMediaStreamDestination();
    const tone = audio.createOscillator();
    tone.connect(dest);
    tone.start();
    navigator.mediaDevices.getUserMedia = async () => dest.stream;
    window.fetch = (input: RequestInfo | URL) => {
      if (!String(input).includes('/api/recognize')) return Promise.reject(new Error('unexpected fetch'));
      return new Promise(resolve => {
        slot.__release = () => resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
      });
    };
  }, payload);
}

async function listen(panel: Page) {
  await panel.locator('#record').click();
  await expect(panel.locator('#status')).toContainText('Listening');
  await panel.waitForTimeout(400);
  await panel.locator('#record').click();
  await expect.poll(() => panel.evaluate(() => Boolean((window as Window & { __release?: () => void }).__release))).toBeTruthy();
}

async function release(panel: Page) {
  await panel.evaluate(() => {
    const slot = window as Window & { __release?: () => void };
    if (!slot.__release) throw new Error('recognition was not waiting');
    slot.__release();
  });
}

async function spoken(panel: Page): Promise<string> {
  return panel.evaluate(() => ((window as Window & { __spoken?: string[] }).__spoken || []).join('\n'));
}
