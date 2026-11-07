/** Confirmation-gated Gemini browser agent embedded in Headway Voice. */
import { startRecording, type RecordingSession } from '../../../../packages/shared/src/audio.ts';
import { validateBrowserPlan, actionDescription, searchUrl, type BrowserPlan } from './plan.ts';
import { loadVoiceProfile } from '../voice/store.ts';
import { getLibrarian } from '../voice/toolkit-host.ts';

type Page = { tabId: number; url: string; origin: string; nonce: string; user: string; token: string };
// The speech API. Local single-user pilot: the FastAPI server on this laptop.
// Override with chrome.storage.local.headwayApiBase (e.g. the Railway URL).
const RAILWAY_API = 'https://speech-api-production-038d.up.railway.app';
let API = 'http://127.0.0.1:8000';
// Set from GET /v1/extension/config: on a local single-user server no personal
// credentials are sent, and the server's fixed pilot profile is used.
let singleUser = false;
let localProfile = '';
function authHeaders(page: Page): Record<string, string> {
  return singleUser ? {} : { 'x-sauti-user': page.user, 'x-sauti-user-token': page.token };
}
const KEY = 'headwayAgentOrigins';
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const value = (id: string): string => el<HTMLInputElement>(id).value.trim();
const say = (message: string): void => { el('agent-status').textContent = message; };
let pending: { page: Page; plan: BrowserPlan } | null = null;
let recording: RecordingSession | null = null;
let recordedPage: Page | null = null;
let busy = false;
let lastModelId = '';
function clear() { pending = null; el<HTMLButtonElement>('agent-confirm').disabled = true; }

async function granted(): Promise<string[]> {
  const v = (await chrome.storage.local.get(KEY))[KEY];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
async function identity(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['dist/agent-content.js'] });
  return chrome.tabs.sendMessage(tabId, { kind: 'HEADWAY_AGENT_IDENTITY' });
}
async function capture(): Promise<Page> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) throw new Error('Open a regular website.');
  const origin = new URL(tab.url).origin;
  if (!(await granted()).includes(origin)) throw new Error('Enable this website for Headway Agent first.');
  const user = value('agent-user'), token = value('agent-token');
  if (!singleUser && (!user || !token)) throw new Error('Enter the personal user ID and access token.');
  const id = await identity(tab.id);
  if (!id?.ok || id.url !== tab.url || typeof id.nonce !== 'string') throw new Error('Page identity changed.');
  return { tabId: tab.id, url: tab.url, origin, nonce: id.nonce, user, token };
}
async function samePage(page: Page) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== page.tabId || tab.url !== page.url) return false;
  if (value('agent-user') !== page.user || value('agent-token') !== page.token) return false;
  if (!(await granted()).includes(page.origin)) return false;
  const id = await identity(page.tabId).catch(() => null);
  return id?.ok === true && id.url === page.url && id.nonce === page.nonce;
}
async function propose(text: string, page: Page) {
  clear();
  if (!text || text.length > 400) throw new Error('Provide a browser instruction under 400 characters.');
  say('Gemini is planning one safe action…');
  const response = await fetch(API + '/v1/extension/agent/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(page) },
    body: JSON.stringify({ instruction: text, page_url: page.url }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(String(data.detail || data.error || 'Gemini unavailable.'));
  if (data.executed_action !== false || data.requires_confirmation !== true) throw new Error('Invalid planner response.');
  const plan = validateBrowserPlan(data.plan);
  if (!(await samePage(page))) throw new Error('Page or account changed while planning.');
  if (plan.action === 'none') { say('No action: ' + plan.reason); return; }
  pending = { page, plan };
  el<HTMLButtonElement>('agent-confirm').disabled = false;
  say(actionDescription(plan) + '\nReview the action and press Confirm and execute.');
}
async function voiceTranscript(audio: Blob, page: Page): Promise<string> {
  const model = el<HTMLSelectElement>('agent-model').value;
  const profile = singleUser ? localProfile : value('agent-profile');
  if (!profile) throw new Error('Enter the participant profile ID.');
  const form = new FormData();
  form.append('audio', audio, 'headway-voice.wav');
  form.append('profile_id', profile);
  form.append('model', model);
  form.append('language', model === 'swahili' ? 'sw-KE' : 'en-KE');
  form.append('compare_consent', 'true');
  const response = await fetch(API + '/v1/extension/compare', {
    method: 'POST', headers: authHeaders(page), body: form,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(String(result.detail || result.error || 'Speech comparison unavailable.'));
  const row = result.results?.find((r: {model?: string}) => r.model === model);
  // Accept the fine-tuned upload or the CDLI model the endpoint currently serves,
  // and always say which one answered.
  const modelId = typeof row?.model_id === 'string' ? row.model_id : '';
  if (modelId !== 'sauti-adapt-finetuned-model/' + model && !modelId.startsWith('cdli/')) {
    throw new Error('The speech model that answered could not be identified.');
  }
  lastModelId = modelId;
  if (typeof row.transcript !== 'string' || !row.transcript.trim()) throw new Error('No speech transcript recognized.');
  return row.transcript.trim();
}
async function finishVoice() {
  if (!recording || !recordedPage || busy) return;
  const session = recording, page = recordedPage;
  recording = null; recordedPage = null;
  el<HTMLButtonElement>('agent-record').textContent = 'Record spoken instruction';
  busy = true;
  try {
    say('Transcribing through the private speech model…');
    const text = await voiceTranscript(await session.stop(), page);
    say('Heard (' + lastModelId + '): ' + text);
    if (!(await samePage(page))) throw new Error('Page changed during transcription.');
    el<HTMLTextAreaElement>('agent-instruction').value = text;
    await propose(text, page);
  } catch (error) { clear(); say('No action taken: ' + String(error)); }
  finally { busy = false; }
}
async function execute() {
  const selected = pending;
  clear();
  if (!selected) return;
  const { page, plan } = selected;
  if (!(await samePage(page))) throw new Error('Page or account changed. No action taken.');
  if (plan.action === 'search_web' || plan.action === 'open_url') {
    await chrome.tabs.update(page.tabId, { url: plan.action === 'search_web' ? searchUrl(plan.query) : plan.url });
    say('Navigation completed. Enable the new website before continuing.');
    return;
  }
  const utterance = plan.action === 'scroll' ? 'scroll ' + plan.direction :
    plan.action === 'go_back' ? 'go back' : plan.action === 'read_page' ? 'read this' : '';
  if (!utterance) throw new Error('Unsupported action.');
  const result = await chrome.tabs.sendMessage(page.tabId, { kind: 'HEADWAY_AGENT_ACTION',
    documentNonce: page.nonce, utterance });
  if (result?.ok !== true) throw new Error(String(result?.reason || 'Controller rejected the action.'));
  const feedback = String(result.feedback || 'Action complete.');
  say(feedback);
  if (plan.action === 'read_page') {
    const phrase = new SpeechSynthesisUtterance(feedback.slice(0, 1700));
    speechSynthesis.cancel(); speechSynthesis.speak(phrase);
  }
}
async function connectServer(): Promise<void> {
  const stored = (await chrome.storage.local.get('headwayApiBase')).headwayApiBase;
  if (typeof stored === 'string' && /^https?:\/\//.test(stored)) API = stored.replace(/\/$/, '');
  try {
    const res = await fetch(API + '/v1/extension/config', { signal: AbortSignal.timeout(3000) });
    const cfg = await res.json() as { single_user?: boolean; profile_id?: string | null };
    singleUser = res.ok && cfg.single_user === true;
    localProfile = singleUser && typeof cfg.profile_id === 'string' ? cfg.profile_id : '';
  } catch {
    singleUser = false;
  }
  for (const id of ['agent-user', 'agent-token', 'agent-profile']) {
    const input = document.getElementById(id);
    const label = document.querySelector('label[for="' + id + '"]');
    if (input) (input as HTMLElement).hidden = singleUser;
    if (label) (label as HTMLElement).hidden = singleUser;
  }
  say(singleUser ? 'Connected to the speech server on this laptop. Enable your website first.'
    : API === RAILWAY_API ? 'Using the Railway server. Enter your personal ID and token.'
    : 'Speech server not reachable at ' + API + '.');
}

export function initHeadwayAgent(): void {
  void connectServer();
  el('agent-enable').addEventListener('click', () => { void (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !/^https?:\/\//.test(tab.url)) throw new Error('Open a regular website.');
      const origin = new URL(tab.url).origin;
      await chrome.storage.local.set({ [KEY]: [...new Set([...(await granted()), origin])] });
      say('Agent enabled on ' + origin);
    } catch (e) { say(String(e)); }
  })(); });
  el('agent-disable').addEventListener('click', () => { void (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) throw new Error('No website selected.');
      const origin = new URL(tab.url).origin;
      await chrome.storage.local.set({ [KEY]: (await granted()).filter(s => s !== origin) });
      clear(); say('Agent disabled for ' + origin);
    } catch (e) { say(String(e)); }
  })(); });
  el('agent-plan').addEventListener('click', () => {
    if (busy) return;
    busy = true;
    void (async () => {
      try { await propose(el<HTMLTextAreaElement>('agent-instruction').value.trim(), await capture()); }
      catch (e) { clear(); say('No action taken: ' + String(e)); }
      finally { busy = false; }
    })();
  });
  el('agent-record').addEventListener('click', () => {
    if (busy) return;
    if (recording) { void finishVoice(); return; }
    void (async () => {
      try {
        if (!el<HTMLInputElement>('agent-consent').checked) throw new Error('Give voice and transcript processing consent first.');
        if (!singleUser && !value('agent-profile')) throw new Error('Enter the participant profile ID.');
        const page = await capture();
        clear();
        const profile = await loadVoiceProfile(await getLibrarian()).catch(() => null);
        // Her own longest utterance from voice onboarding; never a short fixed cut-off.
        // The speech API accepts up to 30 s (SAUTI_MAX_CLIP_SECONDS); she can always press Stop sooner.
        const milliseconds = Math.min(profile?.listening?.maxUtteranceMs || 30000, 30000);
        recordedPage = page;
        recording = await startRecording({ maxDurationMs: milliseconds, onAutoStop: () => void finishVoice() });
        el<HTMLButtonElement>('agent-record').textContent = 'Stop and transcribe';
        say('Listening by request. Press Stop after speaking.');
      } catch (e) { recordedPage = null; recording = null; say('Could not record: ' + String(e)); }
    })();
  });
  el('agent-confirm').addEventListener('click', () => {
    if (busy) return;
    busy = true;
    void execute().catch(e => say('No action taken: ' + String(e))).finally(() => { busy = false; });
  });
  el('agent-cancel').addEventListener('click', () => {
    clear(); recording?.cancel(); recording = null; recordedPage = null;
    el<HTMLButtonElement>('agent-record').textContent = 'Record spoken instruction';
    say('Cancelled. No action executed.');
  });
}
