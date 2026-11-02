import { expect, test, chromium, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { USER_ID, USER_TOKEN } from './env';

const extensionPath = path.resolve('apps/extension/dist');

function sineWav(): Buffer {
  const sampleRate = 16000;
  const samples = sampleRate;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.2;
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), 44 + i * 2);
  }
  return data;
}

function startSites(): Promise<ChildProcess> {
  const child = spawn(process.execPath, [path.resolve('e2e/extension-sites.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => reject(error);
    child.once('error', fail);
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('listening')) {
        child.off('error', fail);
        resolve(child);
      }
    });
  });
}

async function scrollTop(page: Page): Promise<number> {
  return page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
}

/** Smooth scrolling keeps moving after the command returns. Wait until it stops. */
async function settleScroll(page: Page): Promise<number> {
  let previous = -1;
  await expect.poll(async () => {
    const current = await scrollTop(page);
    const stable = previous >= 0 && Math.abs(current - previous) < 0.5;
    previous = current;
    return stable;
  }).toBeTruthy();
  return scrollTop(page);
}

test('enabled sites use the real Controller and other sites do not', async () => {
  test.setTimeout(90_000);
  const sites = await startSites();
  const userData = await mkdtemp(path.join(os.tmpdir(), 'sauti-ext-'));
  const context = await chromium.launchPersistentContext(userData, {
    headless: false,
    viewport: { width: 1100, height: 700 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  try {
    let worker = context.serviceWorkers()[0] as Worker | undefined;
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;

    const alpha = await context.newPage();
    await alpha.goto('http://127.0.0.1:3000/');
    await expect(alpha.locator('#marker')).toHaveText('ALPHA-SITE');
    const beta = await context.newPage();
    await beta.goto('http://localhost:3000/');
    await expect(beta.locator('#marker')).toHaveText('BETA-SITE');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const alphaId = await tabId(panel, 'http://127.0.0.1:3000/');
    const betaId = await tabId(panel, 'http://localhost:3000/');

    const blocked = await worker.evaluate(async (id: number) => {
      const api = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      await api.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
      return api.tabs.sendMessage(id, { kind: 'SAUTI_APPROVED_COMMAND', utterance: 'scroll down' });
    }, alphaId);
    expect(blocked.ok).toBeFalsy();
    expect(String(blocked.reason)).toContain('not enabled');
    expect(await scrollTop(alpha)).toBe(0);
    expect(await scrollTop(beta)).toBe(0);

    await press(panel, alphaId, 'test-scroll');
    await expect(panel.locator('#status')).toContainText('not granted');
    expect(await scrollTop(alpha)).toBe(0);

    await press(panel, alphaId, 'grant');
    await expect(panel.locator('#status')).toContainText('Enabled http://127.0.0.1:3000');
    await press(panel, alphaId, 'test-scroll');
    await expect(panel.locator('#status')).toHaveText('Scrolling down.');
    await alpha.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', `
        <h2 style="display:none">SECRET-DISPLAY</h2>
        <h2 style="visibility:hidden">SECRET-VISIBILITY</h2>
        <h2 hidden>SECRET-HIDDEN-ATTR</h2>
        <h2 aria-hidden="true">SECRET-ARIA</h2>
        <h1>Visible title<span style="display:none">SECRET-NESTED</span></h1>
        <p>Visible sentence</p>`);
    });
    const read = await worker.evaluate(async (id: number) => {
      const api = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      return api.tabs.sendMessage(id, { kind: 'SAUTI_APPROVED_COMMAND', utterance: 'read this' });
    }, alphaId);
    expect(String(read.feedback)).toContain('Visible title');
    expect(String(read.feedback)).toContain('Visible sentence');
    expect(String(read.feedback)).not.toContain('SECRET-TOKEN');
    for (const secret of ['SECRET-DISPLAY', 'SECRET-VISIBILITY', 'SECRET-HIDDEN-ATTR', 'SECRET-ARIA', 'SECRET-NESTED']) {
      expect(String(read.feedback)).not.toContain(secret);
    }
    const outline = await worker.evaluate(async (id: number) => {
      const api = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      return api.tabs.sendMessage(id, { kind: 'SAUTI_APPROVED_COMMAND', utterance: "what's on screen" });
    }, alphaId);
    expect(String(outline.feedback)).toContain('Visible title');
    for (const secret of ['SECRET-DISPLAY', 'SECRET-VISIBILITY', 'SECRET-HIDDEN-ATTR', 'SECRET-ARIA', 'SECRET-NESTED']) {
      expect(String(outline.feedback)).not.toContain(secret);
    }
    await expect.poll(() => scrollTop(alpha)).toBeGreaterThan(0);
    expect(await scrollTop(beta)).toBe(0);

    await press(panel, betaId, 'test-scroll');
    await expect(panel.locator('#status')).toContainText('not granted');
    expect(await scrollTop(beta)).toBe(0);

    await press(panel, betaId, 'grant');
    await expect(panel.locator('#status')).toContainText('Enabled http://localhost:3000');
    const betaBeforeScroll = await scrollTop(beta);
    await press(panel, betaId, 'test-scroll');
    await expect(panel.locator('#status')).toHaveText('Scrolling down.');
    const betaSettled = await settleScroll(beta);
    expect(betaSettled).toBeGreaterThan(betaBeforeScroll);

    let previous = -1;
    await expect.poll(async () => {
      const current = await scrollTop(alpha);
      const stable = previous >= 0 && Math.abs(current - previous) < 0.5;
      previous = current;
      return stable;
    }).toBeTruthy();
    const settled = await scrollTop(alpha);
    await press(panel, alphaId, 'disable');
    await expect(panel.locator('#status')).toContainText('Disabled http://127.0.0.1:3000');
    await press(panel, alphaId, 'test-scroll');
    await expect(panel.locator('#status')).toContainText('not granted');
    expect(await scrollTop(alpha)).toBeLessThanOrEqual(settled + 1);

    await panel.locator('#user').fill(USER_ID);
    await panel.locator('#code').fill(USER_TOKEN);
    await panel.locator('#profile').fill('11111111-1111-4111-8111-111111111111');
    const calls = await panel.evaluate(() => {
      const state = { calls: 0 };
      const media = navigator.mediaDevices;
      const original = media.getUserMedia.bind(media);
      media.getUserMedia = (...args) => {
        state.calls += 1;
        void args;
        void original;
        return Promise.reject(new Error('microphone denied in this automated test'));
      };
      (window as Window & { __micCalls?: { calls: number } }).__micCalls = state;
      return state.calls;
    });
    expect(calls).toBe(0);
    await press(panel, betaId, 'record');
    await expect.poll(() => panel.evaluate(() => (window as Window & { __micCalls?: { calls: number } }).__micCalls?.calls ?? 0)).toBe(1);
    await expect(panel.locator('#status')).toContainText('microphone');
    expect(await scrollTop(beta)).toBe(betaSettled);

    const recognized = await panel.evaluate(async ({ user, token, wav }) => {
      const bytes = Uint8Array.from(atob(wav), (char) => char.charCodeAt(0));
      const form = new FormData();
      form.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'tone.wav');
      form.append('profile_id', crypto.randomUUID());
      form.append('language', 'en-KE');
      const response = await fetch('http://127.0.0.1:3000/api/recognize', {
        method: 'POST',
        body: form,
        headers: { 'x-sauti-user': user, 'x-sauti-user-token': token },
      });
      return { http: response.status, body: await response.json() };
    }, { user: USER_ID, token: USER_TOKEN, wav: sineWav().toString('base64') });
    expect(recognized.http).toBe(200);
    expect(recognized.body.status).toBe('rejected');
    expect(recognized.body.intent).toBe('UNKNOWN');
    expect(String(recognized.body.reason)).toContain('MODEL_NOT_READY');
    expect(await scrollTop(beta)).toBe(betaSettled);

    const knownTabs = await panel.evaluate(async () => {
      const api = (globalThis as unknown as { chrome: { tabs: { query: (query: object) => Promise<{ id?: number }[]> } } }).chrome;
      return (await api.tabs.query({})).map((tab) => tab.id);
    });
    const chromePage = await context.newPage();
    await chromePage.goto('chrome://version');
    const chromeId = await panel.evaluate(async (known: Array<number | undefined>) => {
      const api = (globalThis as unknown as { chrome: { tabs: { query: (query: object) => Promise<{ id?: number }[]> } } }).chrome;
      const tabs = await api.tabs.query({});
      return tabs.find((tab) => !known.includes(tab.id))?.id ?? 0;
    }, knownTabs);
    expect(chromeId).toBeGreaterThan(0);
    await press(panel, chromeId, 'grant');
    await expect(panel.locator('#status')).toContainText('Browser internal pages are protected');
  } finally {
    await context.close();
    sites.kill();
    await rm(userData, { recursive: true, force: true });
  }
});

async function tabId(panel: Page, prefix: string): Promise<number> {
  const id = await panel.evaluate(async (prefix: string) => {
    const api = (globalThis as unknown as { chrome: { tabs: { query: (q: object) => Promise<{ id?: number; url?: string }[]> } } }).chrome;
    const tabs = await api.tabs.query({});
    return tabs.find((tab) => tab.url?.startsWith(prefix))?.id ?? 0;
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
