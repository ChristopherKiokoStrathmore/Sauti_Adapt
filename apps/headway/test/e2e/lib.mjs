/**
 * Headway end-to-end runner helpers.
 *
 * - startFixtureServer(): serves test/fixtures/sites on a free 127.0.0.1 port.
 * - startMockApi(): a deterministic, rule-based stand-in for the speech API endpoints the side
 *   panel calls (config, agent/plan v1 + v2, compare). No Gemini, no audio processing.
 * - launchHeadway(): Chrome for Testing with the built extension loaded unpacked, a website tab and
 *   the side panel opened as a tab, plus helpers (instruct, waitStatus, confirm, scrollY, ...).
 * - makeWav(): a fake-microphone WAV from macOS `say` + `afconvert`, written to test/e2e/.tmp/.
 *
 * E2E_LIVE=1 skips the mock and points the panel at the real local server on http://127.0.0.1:8000
 * (real speech models + real Gemini). Never point this at real eCitizen: it shows automated
 * browsers a Cloudflare check, and login/forms/payments are tested on fixtures only.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
export const HEADWAY_ROOT = resolve(here, '..', '..');
export const FIXTURES_ROOT = join(HEADWAY_ROOT, 'test', 'fixtures', 'sites');
export const TMP_ROOT = join(here, '.tmp'); // git-ignored (test/e2e/.gitignore)
export const LIVE = process.env.E2E_LIVE === '1';
export const LIVE_API = 'http://127.0.0.1:8000';
export const PILOT_PROFILE = '00000000-0000-4000-8000-000000000002';
export const MOCK_MODEL_ID = 'cdli/whisper-large-v3_finetuned_kenyan_english_nonstandard_speech_v1.0';

// ---------------------------------------------------------------------------------------------
// HTTP helpers

function listen(server) {
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      ok({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }),
      });
    });
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon',
};

/** Static server for the fixture sites. `url + '/ecitizen-like/'` is the eCitizen-like home. */
export async function startFixtureServer(root = FIXTURES_ROOT) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403).end('Forbidden'); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return listen(server);
}

// ---------------------------------------------------------------------------------------------
// Mock speech API

const UNSAFE = /\b(pay|payment|transfer|money|send|delete|remove|lipa|tuma|futa)\b/i;
const STOP = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'on', 'in', 'my', 'me', 'i', 'and', 'please', 'click',
  'press', 'open', 'tap', 'go', 'button', 'link', 'one', 'bonyeza', 'fungua', 'want', 'need', 'is', 'it', 'this']);
const words = (s) => String(s).toLowerCase().match(/[a-z0-9]+/g) || [];

/**
 * The deterministic planner. v1 rules first; then, if the request carries v2 `affordances`,
 * whole-word overlap with affordance names: one best → click, several tied → clarify (2–3),
 * none → none. Money/sending/deleting is always `none`, as AGENT_V2_CONTRACT.md requires.
 */
export function mockPlan(body) {
  const text = String(body?.instruction || '').trim();
  const t = text.toLowerCase();
  if (!text) return { action: 'none', reason: 'Empty instruction.' };
  if (UNSAFE.test(t)) return { action: 'none', reason: 'Payments, transfers, sending and deleting are not allowed.' };
  if (/\b(scroll down|shuka chini|shuka)\b/.test(t)) return { action: 'scroll', direction: 'down' };
  if (/\b(scroll up|panda juu|panda)\b/.test(t)) return { action: 'scroll', direction: 'up' };
  if (/\b(go back|rudi nyuma|rudi)\b/.test(t)) return { action: 'go_back' };
  if (/\b(read this|read the page|read it|nisomee|soma)\b/.test(t)) return { action: 'read_page' };
  const url = text.match(/\bhttps:\/\/\S+/);
  if (/^(open|fungua)\b/.test(t) && url) return { action: 'open_url', url: url[0] };
  const search = text.match(/^(?:search(?: google)?(?: for)?|tafuta)\s+(.+)$/i);
  if (search) return { action: 'search_web', query: search[1].slice(0, 180) };

  const affordances = Array.isArray(body?.affordances) ? body.affordances : [];
  if (affordances.length) {
    const wanted = words(t).filter((w) => !STOP.has(w));
    const scored = affordances
      .filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string')
      .map((a) => ({ a, score: words(a.name).filter((w) => wanted.includes(w)).length }))
      .filter((x) => x.score > 0)
      .filter((x) => !x.a.submit || /\b(submit|send|pay|continue|tuma)\b/.test(t));
    if (scored.length) {
      const best = Math.max(...scored.map((x) => x.score));
      const top = scored.filter((x) => x.score === best);
      if (top.length === 1) return { action: 'click', target_id: top[0].a.id };
      return { action: 'clarify', question: 'Which one did you mean?', options: top.slice(0, 3).map((x) => ({ target_id: x.a.id })) };
    }
  }
  return { action: 'none', reason: 'The mock planner did not understand: ' + text.slice(0, 80) };
}

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (origin.startsWith('chrome-extension://')) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, x-sauti-user, x-sauti-user-token');
  }
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

/**
 * Mock speech API. `transcript` (or env HEADWAY_MOCK_TRANSCRIPT) is what /compare "hears".
 * `requests` records every call (path + parsed JSON body, or byte length for multipart) so tests
 * can assert what the extension sent, e.g. that no password reached the planner.
 */
export async function startMockApi({ transcript = process.env.HEADWAY_MOCK_TRANSCRIPT || 'shuka chini' } = {}) {
  const requests = [];
  const state = { transcript };
  const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data)); };
  const server = createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    const path = new URL(req.url, 'http://x').pathname;
    const raw = await readBody(req);
    if (req.method === 'GET' && path === '/v1/extension/config') {
      requests.push({ path });
      json(res, 200, { single_user: true, profile_id: PILOT_PROFILE });
      return;
    }
    if (req.method === 'POST' && path === '/v1/extension/agent/plan') {
      let body;
      try { body = JSON.parse(raw.toString('utf8')); } catch { json(res, 400, { detail: 'Invalid JSON.' }); return; }
      requests.push({ path, body });
      if (typeof body.instruction !== 'string' || !body.instruction.trim() || body.instruction.length > 400) {
        json(res, 422, { detail: 'instruction must be 1–400 characters.' });
        return;
      }
      json(res, 200, { plan: mockPlan(body), requires_confirmation: true, executed_action: false });
      return;
    }
    if (req.method === 'POST' && path === '/v1/extension/compare') {
      requests.push({ path, bytes: raw.length, contentType: req.headers['content-type'] || '' });
      if (!/multipart\/form-data/.test(req.headers['content-type'] || '') || raw.length < 100) {
        json(res, 422, { detail: 'Expected multipart audio.' });
        return;
      }
      const row = (model) => ({ model, model_id: MOCK_MODEL_ID, transcript: state.transcript });
      json(res, 200, { results: [row('english'), row('swahili')] });
      return;
    }
    json(res, 404, { detail: 'Not found in mock: ' + path });
  });
  const handle = await listen(server);
  return { ...handle, requests, setTranscript: (t) => { state.transcript = t; } };
}

// ---------------------------------------------------------------------------------------------
// Browser

/** Chrome for Testing: HEADWAY_CHROME, else Playwright's own chromium, else newest in the cache. */
export function findChrome() {
  if (process.env.HEADWAY_CHROME) {
    if (!existsSync(process.env.HEADWAY_CHROME)) throw new Error('HEADWAY_CHROME does not exist: ' + process.env.HEADWAY_CHROME);
    return process.env.HEADWAY_CHROME;
  }
  try {
    const own = chromium.executablePath();
    if (own && existsSync(own)) return own;
  } catch { /* fall through */ }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : join(homedir(), '.cache', 'ms-playwright'));
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const d of dirs) {
    const base = join(cache, d);
    for (const sub of readdirSync(base)) {
      const candidates = [
        join(base, sub, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        join(base, sub, 'chrome'),
      ];
      const hit = candidates.find((c) => existsSync(c));
      if (hit) return hit;
    }
  }
  throw new Error('Chrome for Testing not found. Run `npx playwright install chromium` or set HEADWAY_CHROME.');
}

/**
 * Generates a 16 kHz mono 16-bit WAV of `text` with macOS `say` + `afconvert`, padded with
 * silence (Chrome loops the fake-mic file, and the panel's end-of-speech wait needs a quiet gap
 * longer than her endOfSpeechMs). Returns null where `say` is missing (e.g. Linux CI).
 */
export function makeWav(text, { voice, name = 'speech', leadingSilenceMs = 500, trailingSilenceMs = 6000 } = {}) {
  if (process.platform !== 'darwin') return null;
  mkdirSync(TMP_ROOT, { recursive: true });
  const aiff = join(TMP_ROOT, name + '.aiff');
  const raw = join(TMP_ROOT, name + '.raw.wav');
  const wav = join(TMP_ROOT, name + '.wav');
  execFileSync('say', [...(voice ? ['-v', voice] : []), '-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, raw]);
  writeFileSync(wav, padWav(readFileSync(raw), leadingSilenceMs, trailingSilenceMs));
  rmSync(aiff, { force: true });
  rmSync(raw, { force: true });
  return wav;
}

/** Re-writes a 16 kHz mono 16-bit PCM WAV as a canonical 44-byte-header WAV with silence around it. */
function padWav(buf, leadMs, tailMs) {
  let offset = 12, data = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4), size = buf.readUInt32LE(offset + 4);
    if (id === 'data') { data = buf.subarray(offset + 8, offset + 8 + size); break; }
    offset += 8 + size + (size % 2);
  }
  if (!data) throw new Error('No data chunk in generated WAV.');
  const rate = 16000, silence = (ms) => Buffer.alloc(Math.round(rate * ms / 1000) * 2);
  const pcm = Buffer.concat([silence(leadMs), data, silence(tailMs)]);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Status lines that mean "still working": instruct() waits until the status is something else.
const TRANSIENT = /^(…|Working out what you mean…|Gemini is planning one safe action…|Writing down .*|Transcribing.*|Listening.*|Heard.*)$/;

/**
 * Launches Chrome with Headway, opens `siteUrl` and the side panel as a tab.
 * Options: wav (fake mic file), apiBase (default: mock url or LIVE_API), headed.
 */
export async function launchHeadway({ siteUrl, apiBase, wav, headed = process.env.HEADWAY_HEADED === '1' } = {}) {
  if (!siteUrl) throw new Error('launchHeadway needs siteUrl.');
  if (!existsSync(join(HEADWAY_ROOT, 'dist', 'sidepanel.js'))) throw new Error('Build Headway first: npm run build');
  mkdirSync(TMP_ROOT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'headway-e2e-'));
  const ext = HEADWAY_ROOT;
  const args = [
    `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    // Chrome loops the file; makeWav() pads it with silence so end-of-speech detection can finish.
    ...(wav ? [`--use-file-for-fake-audio-capture=${wav}`] : []),
  ];
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: findChrome(), headless: !headed, viewport: { width: 1100, height: 800 }, args,
  });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 30000 });
  const extensionId = new URL(sw.url()).host;
  const base = apiBase || LIVE_API;
  // Must be set before the panel loads: connectServer() reads it once on start.
  await sw.evaluate((api) => chrome.storage.local.set({ headwayApiBase: api }), base);

  const site = context.pages()[0] || await context.newPage();
  await site.goto(siteUrl, { waitUntil: 'domcontentloaded' });

  const panel = await context.newPage();
  const errors = [];
  panel.on('pageerror', (e) => errors.push(String(e)));
  await panel.setViewportSize({ width: 400, height: 1000 });
  await panel.goto(`chrome-extension://${extensionId}/dist/sidepanel.html`);
  await installActiveTabShim(panel, new URL(siteUrl).origin);
  await panel.waitForFunction(() => /speech server|Railway server/i.test(document.querySelector('#agent-status')?.textContent || ''),
    null, { timeout: 10000 });

  const status = async () => (await panel.textContent('#agent-status') || '').replace(/\s+/g, ' ').trim();
  const resetStatus = () => panel.evaluate(() => { document.querySelector('#agent-status').textContent = '…'; });
  const timeoutDefault = LIVE ? 90000 : 15000;
  const waitStatus = async (regex, timeout = timeoutDefault) => {
    await panel.waitForFunction(([src, flags]) => new RegExp(src, flags).test(document.querySelector('#agent-status').textContent),
      [regex.source, regex.flags], { timeout });
    return status();
  };
  /** Waits until the status is no longer a "still working" line. */
  const settle = async (timeout = timeoutDefault) => {
    await panel.waitForFunction(([src, flags]) => {
      const s = (document.querySelector('#agent-status').textContent || '').replace(/\s+/g, ' ').trim();
      return s !== '' && !new RegExp(src, flags).test(s);
    }, [TRANSIENT.source, TRANSIENT.flags], { timeout });
    return status();
  };
  const result = async (s) => ({ status: s, canConfirm: !(await panel.isDisabled('#agent-confirm')),
    choices: await panel.$$eval('#agent-choices button', (bs) => bs.map((b) => b.textContent.trim())).catch(() => []) });

  return {
    context, site, panel, extensionId, errors, apiBase: base,
    status, waitStatus, settle,
    /** Enables the panel's current website (the shimmed active tab). */
    async enable() { await resetStatus(); await panel.click('#agent-enable'); return settle(); },
    async disable() { await resetStatus(); await panel.click('#agent-disable'); return settle(); },
    /**
     * Types an instruction and presses the panel's "do this / plan" button. Resolves, once the
     * panel has finished working, with { status, canConfirm, choices }.
     */
    async instruct(text, { timeout } = {}) {
      await panel.fill('#agent-instruction', text);
      await resetStatus();
      await panel.click('#agent-plan');
      return result(await settle(timeout));
    },
    /** Presses the confirm button ("Yes, do it") and waits for the outcome. */
    async confirm() {
      await resetStatus();
      await panel.click('#agent-confirm');
      return result(await settle());
    },
    /** Presses the record/Speak button and waits until the panel has handled what it heard. */
    async speak({ timeout = LIVE ? 240000 : 30000 } = {}) {
      await resetStatus();
      await panel.click('#agent-record');
      return result(await settle(timeout));
    },
    async canConfirm() { return !(await panel.isDisabled('#agent-confirm')); },
    scrollY: () => site.evaluate(() => Math.round(window.scrollY)),
    /** Waits for a (smooth) scroll to finish: scrollY unchanged for 400 ms. Returns scrollY. */
    scrollSettled: () => site.evaluate(() => new Promise((done) => {
      let last = -1, still = 0;
      const tick = setInterval(() => {
        const y = Math.round(window.scrollY);
        still = y === last ? still + 100 : 0; last = y;
        if (still >= 400) { clearInterval(tick); done(y); }
      }, 100);
    })),
    /** Navigates the website tab and re-points the active-tab shim at its origin. */
    async goto(url) { await site.goto(url, { waitUntil: 'domcontentloaded' }); await installActiveTabShim(panel, new URL(url).origin); },
    async close() { await context.close(); rmSync(profile, { recursive: true, force: true }); },
  };
}

/**
 * Test shim only. In a real side panel, chrome.tabs.query({active, currentWindow}) returns the
 * website. Automation cannot open a side panel as a side panel, so the panel is a tab here and
 * would find itself. The shim returns the website tab instead (matched by origin).
 */
async function installActiveTabShim(panel, origin) {
  await panel.evaluate((o) => {
    const g = /** @type {any} */ (globalThis);
    g.__headwayOriginalQuery ||= chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async () => (await g.__headwayOriginalQuery({})).filter((t) => t.url && t.url.startsWith(o + '/'));
  }, origin);
}

/** Sets up fixtures + API (mock unless E2E_LIVE=1). Returns servers and a stop() for after(). */
export async function startServers(mockOptions) {
  const fixtures = await startFixtureServer();
  const api = LIVE ? null : await startMockApi(mockOptions);
  return {
    fixtures, api, apiBase: api ? api.url : LIVE_API,
    async stop() { await fixtures.close(); await api?.close(); },
  };
}
