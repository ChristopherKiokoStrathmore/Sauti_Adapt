/**
 * Headway agent in the side panel: her words → local understanding or Gemini → a
 * safety check → the page. See docs/harness/AGENT_V2_CONTRACT.md.
 *
 * Guards: only on websites she enabled, only on the exact document that was planned
 * against (nonce + URL + the element's current name), re-checked before anything runs.
 * Every request has a number; Cancel or Stop makes older numbers void, so nothing that
 * was cancelled can still act when its answer arrives.
 */
import { validateBrowserPlan, searchUrl, type BrowserPlan } from './plan.ts';
import { loadVoiceProfile } from '../voice/store.ts';
import { getLibrarian } from '../voice/toolkit-host.ts';
import type { VoiceProfile } from '../voice/profile.ts';
import {
  parseLocal, matchAffordances, riskOf, needsConfirmation, maskedReadBack, looksSecret, choiceIndex,
  KNOWN_SITES, type Affordance,
} from '../harness/local.ts';
import { Listener, DEFAULT_LISTEN, type ListenSettings } from '../harness/listen.ts';

type Page = { tabId: number; url: string; origin: string; nonce: string; user: string; token: string };
type Snapshot = { title: string; elements: Affordance[]; focused: { id: string; kind: Affordance['kind'] } | null };
class Cancelled extends Error {}

// The speech API. Local single-user pilot: the FastAPI server on this laptop.
// Override with chrome.storage.local.headwayApiBase (e.g. the Railway URL).
const RAILWAY_API = 'https://speech-api-production-038d.up.railway.app';
let API = 'http://127.0.0.1:8000';
let connected = false;
let singleUser = false;
let localProfile = '';
let serverMaxClipMs = 5000;           // the server's SAUTI_MAX_CLIP_SECONDS, from /v1/extension/config
const KEY = 'headwayAgentOrigins';
const CONSENT_KEY = 'headwayAgentVoiceConsent';
const KNOWN_HOSTS = new Set(Object.values(KNOWN_SITES).map((u) => new URL(u).hostname));

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const value = (id: string): string => el<HTMLInputElement>(id).value.trim();

let voice: VoiceProfile | null = null;
let pendingConfirm: { page: Page; question: string; run: () => Promise<string> } | null = null;
let pendingChoices: { page: Page; options: Affordance[] } | null = null;
let busy = false;
let generation = 0;
let lastModelId = '';
const listener = new Listener();

// ---------------------------------------------------------------- feedback

function show(message: string) { el('agent-status').textContent = message; }

/** Text always; speech or a sound as she chose in onboarding (speech if she hasn't). */
function respond(message: string, tone: 'ok' | 'ask' | 'no' = 'ok') {
  show(message);
  const how = voice?.setup?.feedback ?? 'speech';
  if (how === 'speech') {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(message.slice(0, 400));
    u.lang = voice?.language === 'sw' ? 'sw-KE' : 'en-KE';
    speechSynthesis.speak(u);
  } else if (how === 'sound') {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = tone === 'no' ? 220 : tone === 'ask' ? 520 : 880;
    g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.18); o.onended = () => void ctx.close();
  }
}

function confirmPolicy(): 'always' | 'forms' | 'never' { return voice?.setup?.confirm ?? 'forms'; }

function clearPending(page?: Page) {
  const badgesOn = page ?? pendingChoices?.page ?? pendingConfirm?.page;
  pendingConfirm = null;
  pendingChoices = null;
  el<HTMLButtonElement>('agent-confirm').disabled = true;
  el('agent-choices').innerHTML = '';
  if (badgesOn) void pageOp(badgesOn, 'clear').catch(() => {});
}

/** Everything in flight stops mattering: answers that arrive later are ignored. */
function cancelAll(message = 'Cancelled. Nothing was done.') {
  generation++;
  listener.cancel();
  speechSynthesis.cancel();
  clearPending();
  busy = false;
  el<HTMLButtonElement>('agent-record').textContent = 'Speak';
  show(message);
}

function ask(page: Page, question: string, run: () => Promise<string>) {
  pendingConfirm = { page, question, run };
  el<HTMLButtonElement>('agent-confirm').disabled = false;
  respond(question, 'ask');
}

// ---------------------------------------------------------------- page access

function authHeaders(): Record<string, string> {
  return singleUser ? {} : { 'x-sauti-user': value('agent-user'), 'x-sauti-user-token': value('agent-token') };
}
async function granted(): Promise<string[]> {
  const v = (await chrome.storage.local.get(KEY))[KEY];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
async function grant(origin: string) {
  await chrome.storage.local.set({ [KEY]: [...new Set([...(await granted()), origin])] });
}
async function anyTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No tab is open.');
  return tab as chrome.tabs.Tab & { id: number };
}
async function activeTab() {
  const tab = await anyTab();
  if (!tab.url || !/^https?:\/\//.test(tab.url)) throw new Error('Open a regular website first.');
  return tab as chrome.tabs.Tab & { id: number; url: string };
}
async function identity(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['dist/agent-content.js'] });
  return chrome.tabs.sendMessage(tabId, { kind: 'HEADWAY_AGENT_IDENTITY' });
}
async function capture(): Promise<Page> {
  const tab = await activeTab();
  const origin = new URL(tab.url).origin;
  if (!(await granted()).includes(origin)) throw new Error('Headway is not switched on for this website. Say "enable this website" or press Enable.');
  const user = value('agent-user'), token = value('agent-token');
  if (!singleUser && (!user || !token)) throw new Error('Enter the personal user ID and access token.');
  const id = await identity(tab.id);
  if (!id?.ok || id.url !== tab.url || typeof id.nonce !== 'string') throw new Error('Page identity changed.');
  return { tabId: tab.id, url: tab.url, origin, nonce: id.nonce, user, token };
}
async function samePage(page: Page) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== page.tabId || tab.url !== page.url) return false;
  if (!(await granted()).includes(page.origin)) return false;
  const id = await identity(page.tabId).catch(() => null);
  return id?.ok === true && id.url === page.url && id.nonce === page.nonce;
}
async function pageOp<T = { ok: boolean; reason?: string; detail?: string; kind?: Affordance['kind']; name?: string }>(page: Page, op: string, extra: Record<string, unknown> = {}): Promise<T> {
  return chrome.tabs.sendMessage(page.tabId, { kind: 'HEADWAY_AGENT_PAGE', documentNonce: page.nonce, op, ...extra });
}
async function snapshotOf(page: Page): Promise<Snapshot> {
  const s = await pageOp<{ ok: boolean } & Snapshot>(page, 'snapshot');
  if (!s?.ok) throw new Error('Could not read this page.');
  return s;
}
/** Is this element still there, with the same name and the same "sends a form" status? */
async function stillSame(page: Page, a: Affordance): Promise<boolean> {
  if (!(await samePage(page))) return false;
  const now = (await snapshotOf(page)).elements.find((e) => e.id === a.id);
  return !!now && now.name === a.name && now.submit === a.submit;
}
/** Scroll / back / read through the official AI4A11y Controller in the page. */
async function controllerAction(page: Page, utterance: 'scroll up' | 'scroll down' | 'go back' | 'read this'): Promise<string> {
  const result = await chrome.tabs.sendMessage(page.tabId, { kind: 'HEADWAY_AGENT_ACTION', documentNonce: page.nonce, utterance });
  if (result?.ok !== true) throw new Error(String(result?.reason || 'The page did not accept that.'));
  return String(result.feedback || 'Done.');
}
/** Page address for Gemini: never the query string or fragment (they can carry IDs or tokens). */
function safeUrl(url: string): string {
  try { const u = new URL(url); return (u.origin + u.pathname).slice(0, 300); } catch { return ''; }
}

// ---------------------------------------------------------------- acting on one element

async function actOn(page: Page, a: Affordance, opts: { focusOnly?: boolean; check?: boolean } = {}) {
  // Fields are for typing into, and "focus" plans only ever move to an element.
  if (opts.focusOnly || ['textbox', 'number', 'password', 'select'].includes(a.kind)) {
    const r = await pageOp(page, 'focus', { id: a.id });
    if (!r.ok) throw new Error(r.reason || 'Could not reach that.');
    respond(a.kind === 'password'
      ? `On "${a.name}". Passwords are not said aloud: use Chrome's saved password, or the site's OTP or Digital ID sign-in.`
      : a.kind === 'select' ? `On "${a.name}". Say "choose" and an option.`
      : ['textbox', 'number'].includes(a.kind) ? `On "${a.name}". Say "type" and what to enter.`
      : `On "${a.name}". Say "click ${a.name}" to press it.`);
    return;
  }
  const risk = riskOf(a);
  const run = async () => {
    if (!(await stillSame(page, a))) throw new Error('The page changed. Nothing was pressed.');
    const isBox = a.kind === 'checkbox' || a.kind === 'radio';
    const r = await pageOp(page, isBox ? 'choose' : 'click', { id: a.id, check: opts.check });
    if (!r.ok) throw new Error(r.reason || 'Could not press that.');
    return r.detail || `Pressed "${a.name}".`;
  };
  if (needsConfirmation(risk, confirmPolicy())) {
    ask(page, risk === 'submit'
      ? `This sends or changes the form. The button says "${a.name}". Say yes to go ahead, or no.`
      : `Press "${a.name}"? Say yes or no.`, run);
    return;
  }
  respond(await run());
}

async function offerChoices(page: Page, options: Affordance[], question = 'Which one?') {
  const top = options.slice(0, 3);
  pendingChoices = { page, options: top };
  await pageOp(page, 'badges', { ids: top.map((o) => o.id) }).catch(() => {});
  const list = el('agent-choices');
  list.innerHTML = '';
  top.forEach((o, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-secondary choice-btn';
    b.textContent = `${i + 1}. ${o.name}`;
    b.addEventListener('click', () => void guard(() => handle(String(i + 1))));
    list.appendChild(b);
  });
  const more = options.length > 3 ? ` (${options.length} match: say the name more fully to see others)` : '';
  respond(`${question} ${top.map((o, i) => `${i + 1}: ${o.name}.`).join(' ')} Say the number.${more}`, 'ask');
}

// ---------------------------------------------------------------- the decision flow

/** One instruction, typed or spoken. Local first; Gemini only when nothing local fits. */
async function handle(text: string): Promise<void> {
  const said = text.trim();
  if (!said) return;
  if (said.length > 400) throw new Error('That was too long. Try a shorter instruction.');
  const mine = generation;
  const live = () => { if (mine !== generation) throw new Cancelled(); };
  const intent = parseLocal(said);

  // Answers to a question she was just asked.
  if (pendingConfirm) {
    const p = pendingConfirm;
    if (intent.kind === 'yes') { clearPending(p.page); respond(await p.run()); return; }
    if (intent.kind === 'no') { clearPending(p.page); respond('Cancelled. Nothing was done.', 'no'); return; }
    clearPending(p.page); // anything else drops the question and is handled fresh
  }
  if (pendingChoices) {
    const pick = intent.kind === 'choice' ? intent.index : intent.kind === 'click' ? choiceIndex(intent.label) : null;
    if (pick !== null) {
      const { page, options } = pendingChoices;
      clearPending(page);
      const chosen = options[pick];
      if (!chosen) { respond('There is no choice with that number.', 'no'); return; }
      await actOn(page, chosen, intent.kind === 'click' ? { check: intent.check } : {});
      return;
    }
    if (intent.kind === 'no') { clearPending(); respond('Cancelled. Nothing was done.', 'no'); return; }
    clearPending();
  }
  if (intent.kind === 'yes' || intent.kind === 'no') { show('Nothing is waiting for an answer.'); return; }
  if (intent.kind === 'stop') { cancelAll('Stopped.'); return; }

  // Things that need no access to the page.
  if (intent.kind === 'enable-site') {
    const tab = await activeTab();
    await grant(new URL(tab.url).origin);
    respond('Headway is on for ' + new URL(tab.url).hostname + '.');
    return;
  }
  if (intent.kind === 'open') {
    const tab = await anyTab();
    await chrome.tabs.update(tab.id, { url: intent.url });
    respond(`Opening ${new URL(intent.url).hostname}. Say "enable this website" to use Headway there.`);
    return;
  }
  if (intent.kind === 'search') {
    const tab = await anyTab();
    await chrome.tabs.update(tab.id, { url: searchUrl(intent.query) });
    respond('Searching for ' + intent.query + '.');
    return;
  }
  if (intent.kind === 'password') {
    respond("Passwords are not said aloud. Use Chrome's saved password for this site, or the site's OTP or Digital ID sign-in.", 'no');
    return;
  }

  // On a page she has not enabled, only navigation can be planned (no page access at all).
  const tab = await anyTab();
  const enabled = !!tab.url && /^https?:\/\//.test(tab.url) && (await granted()).includes(new URL(tab.url).origin);
  if (!enabled) {
    if (intent.kind !== 'none' && intent.kind !== 'click') throw new Error('Headway is not switched on for this website. Say "enable this website" first.');
    if (looksSecret(said)) { respond('That sounds private, so it stays on this computer. Choose a field on the page first.', 'no'); return; }
    await askGemini(said, null, tab.url && /^https:\/\//.test(tab.url) ? tab.url : '', mine);
    return;
  }

  const page = await capture();
  live();
  clearPending(page);

  switch (intent.kind) {
    case 'scroll': respond(await controllerAction(page, intent.direction === 'up' ? 'scroll up' : 'scroll down')); return;
    case 'back': respond(await controllerAction(page, 'go back')); return;
    case 'read': {
      const words = await controllerAction(page, 'read this');
      show(words);
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(words.slice(0, 1700));
      u.lang = voice?.language === 'sw' ? 'sw-KE' : 'en-KE';
      speechSynthesis.speak(u);
      return;
    }
    case 'type': {
      const snap = await snapshotOf(page);
      live();
      const field = snap.focused;
      if (!field || !['textbox', 'number'].includes(field.kind)) {
        respond('Choose a field first: say "click" and its name, then say what to type.', 'no');
        return;
      }
      const name = snap.elements.find((e) => e.id === field.id)?.name ?? 'this field';
      const readBack = maskedReadBack(intent.text, field.kind);
      const run = async () => {
        if (!(await samePage(page))) throw new Error('The page changed. Nothing was typed.');
        const r = await pageOp(page, 'type', { text: intent.text, id: field.id });
        if (!r.ok) throw new Error(r.reason || 'Could not type there.');
        return readBack[0].toUpperCase() + readBack.slice(1) + '.';
      };
      if (needsConfirmation('change', confirmPolicy())) { ask(page, `Type into "${name}": ${readBack.replace(/ entered$/, '')}? Say yes or no.`, run); return; }
      respond(await run());
      return;
    }
    case 'click': {
      const snap = await snapshotOf(page);
      live();
      const matches = matchAffordances(intent.label, snap.elements);
      if (matches.length === 1) { await actOn(page, matches[0], { check: intent.check }); return; }
      if (matches.length > 1) { await offerChoices(page, matches); return; }
      // Not a button or link: maybe an option in a dropdown ("choose Nairobi").
      if (snap.elements.some((e) => e.kind === 'select')) {
        const run = async () => {
          const picked = await pageOp(page, 'chooseOption', { option: intent.label });
          if (!picked.ok) throw new Error(picked.reason || 'Could not choose that.');
          return picked.detail || 'Chosen.';
        };
        if (needsConfirmation('change', confirmPolicy())) { ask(page, `Choose "${intent.label}"? Say yes or no.`, run); return; }
        const picked = await pageOp(page, 'chooseOption', { option: intent.label });
        if (picked.ok) { respond(picked.detail || 'Chosen.'); return; }
        if (picked.reason && picked.reason !== 'none') { respond(picked.reason, 'no'); return; }
      }
      break; // nothing by that name: let Gemini work out what she means
    }
    case 'choice':
      respond('There is nothing to choose from right now.', 'no');
      return;
  }
  if (looksSecret(said)) {
    respond('That sounds private, so it stays on this computer and is not sent to Gemini. To type it, say "click" and the field name, then "type" and the value.', 'no');
    return;
  }
  await askGemini(said, page, page.url, mine);
}

function readableError(data: { detail?: unknown; error?: unknown }): string {
  const d = data.detail ?? data.error;
  if (Array.isArray(d)) return 'The request was not accepted (' + d.map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: unknown }).msg) : String(x))).join('; ').slice(0, 200) + ').';
  return typeof d === 'string' ? d : 'Gemini is not available.';
}

async function askGemini(said: string, page: Page | null, url: string, mine: number) {
  const live = () => { if (mine !== generation) throw new Cancelled(); };
  const snap = page ? await snapshotOf(page).catch(() => null) : null;
  live();
  show('Working out what you mean…');
  const commands = voice?.setup?.commands?.slice(0, 40).map((c) => ({ id: c.id.slice(0, 40), phrases: c.phrases.slice(0, 10).map((p) => p.slice(0, 80)) })) ?? [];
  const body = {
    instruction: said,
    page_url: safeUrl(url),
    page_title: snap?.title ?? '',
    // Names of buttons, links and fields only: never page text, never field values.
    affordances: snap?.elements.map(({ id, kind, name, submit }) => ({ id, kind, name, submit })) ?? [],
    profile: { language: voice?.language ?? 'both', confirm: confirmPolicy(), commands },
  };
  const response = await fetch(API + '/v1/extension/agent/plan', {
    method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(body),
  });
  const data = await response.json();
  live();
  if (!response.ok) throw new Error(readableError(data));
  if (data.executed_action !== false) throw new Error('Invalid planner response.');
  const ids = new Set(snap?.elements.map((e) => e.id) ?? []);
  const plan: BrowserPlan = validateBrowserPlan(data.plan, ids);
  if (page && !(await samePage(page))) throw new Error('The page changed while Headway was thinking. Nothing was done.');
  live();
  const tab = page ? { id: page.tabId } : await anyTab();
  const find = (id: string) => snap!.elements.find((e) => e.id === id)!;
  const needPage = (): Page => { if (!page) throw new Error('Headway is not switched on for this website. Say "enable this website" first.'); return page; };

  switch (plan.action) {
    case 'none': respond('Nothing was done. ' + plan.reason, 'no'); return;
    case 'search_web':
      await chrome.tabs.update(tab.id, { url: searchUrl(plan.query) });
      respond('Searching for ' + plan.query + '.');
      return;
    case 'open_url': {
      const host = new URL(plan.url).hostname;
      const go = async () => { await chrome.tabs.update(tab.id, { url: plan.url }); return `Opening ${host}. Say "enable this website" to use Headway there.`; };
      // Sites not on her known list are read back first: a page label could try to send her elsewhere.
      if (KNOWN_HOSTS.has(host) || !page) { respond(await go()); return; }
      ask(page, `Open ${host}? Say yes or no.`, go);
      return;
    }
    case 'scroll': respond(await controllerAction(needPage(), plan.direction === 'up' ? 'scroll up' : 'scroll down')); return;
    case 'go_back': respond(await controllerAction(needPage(), 'go back')); return;
    case 'read_page': return handle('read this');
    case 'click': await actOn(needPage(), find(plan.target_id)); return;
    case 'focus': await actOn(needPage(), find(plan.target_id), { focusOnly: true }); return;
    case 'clarify': await offerChoices(needPage(), plan.options.map(find), plan.question); return;
  }
}

// ---------------------------------------------------------------- voice

function listenSettings(): ListenSettings {
  const l = voice?.listening;
  const cap = Math.max(4000, serverMaxClipMs - 600); // stay under the server's limit, with room for buffering
  return {
    endOfSpeechMs: l?.endOfSpeechMs ?? DEFAULT_LISTEN.endOfSpeechMs,
    maxUtteranceMs: Math.min(l?.maxUtteranceMs ?? DEFAULT_LISTEN.maxUtteranceMs, cap),
    noSpeechTimeoutMs: l?.noSpeechTimeoutMs ? Math.max(l.noSpeechTimeoutMs, 6000) : DEFAULT_LISTEN.noSpeechTimeoutMs,
    floorDb: voice?.room?.noiseDb ?? DEFAULT_LISTEN.floorDb,
  };
}

async function transcribe(wav: Blob): Promise<string> {
  const model = el<HTMLSelectElement>('agent-model').value;
  const profile = singleUser ? localProfile : value('agent-profile');
  if (!profile) throw new Error('Enter the participant profile ID.');
  const form = new FormData();
  form.append('audio', wav, 'headway-voice.wav');
  form.append('profile_id', profile);
  form.append('model', model);
  form.append('language', model === 'swahili' ? 'sw-KE' : 'en-KE');
  form.append('compare_consent', 'true');
  const response = await fetch(API + '/v1/extension/compare', { method: 'POST', headers: authHeaders(), body: form });
  const result = await response.json();
  if (!response.ok) throw new Error(readableError(result));
  const row = result.results?.find((r: { model?: string }) => r.model === model);
  // Accept the fine-tuned upload or the CDLI model the endpoint serves now; always say which.
  const modelId = typeof row?.model_id === 'string' ? row.model_id : '';
  if (modelId !== 'sauti-adapt-finetuned-model/' + model && !modelId.startsWith('cdli/')) {
    throw new Error('The speech model that answered could not be identified.');
  }
  lastModelId = modelId;
  if (typeof row.transcript !== 'string' || !row.transcript.trim()) throw new Error("Headway didn't catch that. Nothing was done.");
  return row.transcript.trim();
}

async function speak() {
  if (listener.active) { listener.finish(); return; }
  if (busy) { cancelAll(); return; }     // her key or Speak while Headway is working = stop
  if (!connected) await connectServer();
  if (!el<HTMLInputElement>('agent-consent').checked) throw new Error('Tick the consent box first: your voice goes to our speech service, and the words to Gemini.');
  const mine = generation;
  const button = el<HTMLButtonElement>('agent-record');
  const s = listenSettings();
  busy = true;
  button.textContent = 'Listening… press to finish';
  show(`Listening. Take your time; Headway waits ${(s.endOfSpeechMs / 1000).toFixed(1)} s after you stop.`);
  speechSynthesis.cancel();
  try {
    let result;
    try {
      result = await listener.listen(s, (quiet, heard) => {
        if (heard) show(`Listening… quiet for ${(quiet / 1000).toFixed(1)} of ${(s.endOfSpeechMs / 1000).toFixed(1)} s`);
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'NotFoundError') {
        throw new Error('Headway has no microphone yet. Run "Teach Headway my voice" once: it asks Chrome for the microphone.');
      }
      throw e;
    }
    if (mine !== generation) return;
    button.textContent = 'Working… press to stop';
    if (!result.heard) { respond("Headway didn't hear anything. Press Speak and try again.", 'no'); return; }
    show(`Writing down ${result.seconds.toFixed(0)} s of speech…`);
    const text = await transcribe(result.wav);
    if (mine !== generation) return;
    el<HTMLTextAreaElement>('agent-instruction').value = text;
    show(`Heard: "${text}"`);
    await handle(text);
  } finally {
    if (mine === generation) { button.textContent = 'Speak'; busy = false; }
  }
}

// ---------------------------------------------------------------- wiring

async function guard(fn: () => Promise<void>) {
  try { await fn(); } catch (e) {
    if (e instanceof Cancelled) return;
    clearPending();
    respond(e instanceof Error ? e.message : String(e), 'no');
  }
}

async function connectServer(): Promise<void> {
  const stored = (await chrome.storage.local.get('headwayApiBase')).headwayApiBase;
  if (typeof stored === 'string' && /^https?:\/\//.test(stored)) API = stored.replace(/\/$/, '');
  try {
    const res = await fetch(API + '/v1/extension/config', { signal: AbortSignal.timeout(3000) });
    const cfg = await res.json() as { single_user?: boolean; profile_id?: string | null; max_clip_seconds?: number };
    connected = res.ok;
    singleUser = res.ok && cfg.single_user === true;
    localProfile = singleUser && typeof cfg.profile_id === 'string' ? cfg.profile_id : '';
    if (typeof cfg.max_clip_seconds === 'number' && cfg.max_clip_seconds > 0) serverMaxClipMs = cfg.max_clip_seconds * 1000;
  } catch {
    connected = false;
    singleUser = false;
  }
  for (const id of ['agent-user', 'agent-token', 'agent-profile']) {
    const input = document.getElementById(id);
    const label = document.querySelector('label[for="' + id + '"]');
    if (input) (input as HTMLElement).hidden = singleUser;
    if (label) (label as HTMLElement).hidden = singleUser;
  }
  show(singleUser ? 'Connected to the speech server on this laptop. Enable your website, then press Speak.'
    : connected && API === RAILWAY_API ? 'Using the Railway server. Enter your personal ID and token.'
    : 'Speech server not reachable at ' + API + '. Start it, then press Speak.');
}

async function loadVoice() {
  voice = await loadVoiceProfile(await getLibrarian()).catch(() => null);
  el<HTMLSelectElement>('agent-model').value = voice?.language === 'sw' ? 'swahili' : 'english';
}

export function initHeadwayAgent(): void {
  void connectServer();
  void loadVoice();
  void chrome.storage.local.get(CONSENT_KEY).then((r) => { el<HTMLInputElement>('agent-consent').checked = r[CONSENT_KEY] === true; });
  el('agent-consent').addEventListener('change', () => {
    void chrome.storage.local.set({ [CONSENT_KEY]: el<HTMLInputElement>('agent-consent').checked });
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes['aa.mine.profile']) void loadVoice(); });

  el('agent-enable').addEventListener('click', () => void guard(() => handle('enable this website')));
  el('agent-disable').addEventListener('click', () => void guard(async () => {
    const tab = await activeTab();
    const origin = new URL(tab.url).origin;
    await chrome.storage.local.set({ [KEY]: (await granted()).filter((s) => s !== origin) });
    clearPending();
    respond('Headway is off for ' + new URL(tab.url).hostname + '.');
  }));
  el('agent-plan').addEventListener('click', () => {
    if (busy) return;
    busy = true;
    const mine = generation;
    void (async () => { if (!connected) await connectServer(); await guard(() => handle(el<HTMLTextAreaElement>('agent-instruction').value)); })()
      .finally(() => { if (mine === generation) busy = false; });
  });
  el('agent-record').addEventListener('click', () => void guard(speak));
  el('agent-confirm').addEventListener('click', () => void guard(() => handle('yes')));
  el('agent-cancel').addEventListener('click', () => cancelAll());
  // Her key (Alt+Shift+H, relayed by the background worker) starts, finishes, or stops.
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type === 'HEADWAY_VOICE_TRIGGER') void guard(speak);
  });
}
