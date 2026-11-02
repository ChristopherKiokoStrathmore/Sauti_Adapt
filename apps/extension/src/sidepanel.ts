import { commandToUtterance, validRecognition } from '@sauti/shared';
import { clampClipMs, startRecording, type RecordingSession } from '@sauti/shared/audio';
import { isReadAloudUtterance, speakText, stopSpeaking } from '@sauti/shared/speak';
import { ENABLED_ORIGINS_KEY, readEnabledOrigins, withOrigin } from './allowlist';

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const recordBtn = input('record') as HTMLButtonElement;
const stopBtn = input('stop') as HTMLButtonElement;
const silenceBtn = input('silence') as HTMLButtonElement;
const status = document.getElementById('status')!;
let recording: RecordingSession | null = null;
let finishing = false;
function say(message: string) { status.textContent = message; }
function toggleMode() { return (document.getElementById('listen') as HTMLSelectElement).value !== 'separate'; }
function syncButtons() {
  const listening = recording !== null;
  const toggle = toggleMode();
  recordBtn.disabled = finishing || (!toggle && listening);
  recordBtn.setAttribute('aria-pressed', toggle && listening ? 'true' : 'false');
  recordBtn.textContent = toggle && listening ? '■ Stop and recognize' : '🎙 Start listening';
  stopBtn.hidden = toggle;
  stopBtn.disabled = toggle || !listening || finishing;
}

type BoundPage = { tabId: number; origin: string; url: string; documentNonce: string; userId: string; token: string };
let bound: BoundPage | null = null;

async function focusedHttpTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) {
    throw new Error('Open a regular HTTP or HTTPS website. Browser internal pages are protected.');
  }
  return { tabId: tab.id, origin: new URL(tab.url).origin, url: tab.url };
}

async function pageIdentity(tabId: number): Promise<{ nonce: string; href: string } | null> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const identity = await chrome.tabs.sendMessage(tabId, { kind: 'SAUTI_PAGE_IDENTITY' });
  if (!identity?.ok || typeof identity.nonce !== 'string') return null;
  return { nonce: identity.nonce, href: String(identity.href || '') };
}

async function enabledOrigins(): Promise<string[]> {
  const stored = await chrome.storage.local.get(ENABLED_ORIGINS_KEY);
  return readEnabledOrigins(stored[ENABLED_ORIGINS_KEY]);
}

async function rememberOrigin(origin: string, enabled: boolean) {
  const next = withOrigin(await enabledOrigins(), origin, enabled);
  await chrome.storage.local.set({ [ENABLED_ORIGINS_KEY]: next });
  await renderEnabled();
}

async function renderEnabled() {
  const list = document.getElementById('enabled');
  if (!list) return;
  list.replaceChildren();
  for (const origin of await enabledOrigins()) {
    const item = document.createElement('li');
    item.textContent = origin;
    list.appendChild(item);
  }
}

async function siteEnabled(origin: string) {
  return (await enabledOrigins()).includes(origin);
}

input('grant').addEventListener('click', async () => {
  try {
    const { origin } = await focusedHttpTab();
    const already = await chrome.permissions.contains({ origins: [origin + '/*'] });
    const permitted = already || await chrome.permissions.request({ origins: [origin + '/*'] });
    if (!permitted) { say('Permission denied. No actions will be run.'); return; }
    await rememberOrigin(origin, true);
    say(`Enabled ${origin}. The microphone stays off until you start it.`);
  } catch (e) { say(String(e)); }
});

input('disable').addEventListener('click', async () => {
  try {
    const { origin } = await focusedHttpTab();
    await rememberOrigin(origin, false);
    say(`Disabled ${origin}. Commands will not run on this website.`);
  } catch (e) { say(String(e)); }
});

input('test-scroll').addEventListener('click', () => { void executeOnTab('scroll down'); });

async function executeOnTab(utterance: string) {
  const { tabId, origin } = await focusedHttpTab();
  if (!(await siteEnabled(origin))) { say(`Access to ${origin} is not granted. Select Enable current website.`); return; }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const reply = await chrome.tabs.sendMessage(tabId, { kind: 'SAUTI_MANUAL_COMMAND', utterance });
  const feedback = String(reply?.feedback || reply?.reason || 'The website did not acknowledge the command.');
  say(feedback);
  if (!isReadAloudUtterance(utterance) || reply?.ok === false || !reply?.feedback) return;
  speakReadAloud(feedback);
}

function speakReadAloud(feedback: string) {
  const started = speakText(feedback, 'en-KE', {
    onend: () => { silenceBtn.disabled = true; },
    onerror: () => { silenceBtn.disabled = true; },
  });
  silenceBtn.disabled = !started;
  if (!started) say(feedback + ' Speech playback is unavailable in this panel. The text was not recorded or uploaded.');
}

async function bindingStillValid(page: BoundPage): Promise<string | null> {
  if (!page.userId || !page.token || input('user').value.trim() !== page.userId || input('code').value.trim() !== page.token) {
    return 'Sign-in changed while speech was processing. No action was taken.';
  }
  const tab = await chrome.tabs.get(page.tabId).catch(() => null);
  if (!tab?.id || !tab.url) return 'The page where you started speaking is gone. No action was taken.';
  let origin = '';
  try { origin = new URL(tab.url).origin; } catch { return 'The page where you started speaking is gone. No action was taken.'; }
  if (tab.url !== page.url || origin !== page.origin) return 'The page changed since you started speaking. No action was taken.';
  if (!(await siteEnabled(page.origin))) return 'This website was disabled while speech was processing. No action was taken.';
  if (!(await chrome.permissions.contains({ origins: [page.origin + '/*'] }))) return 'Permission for this website was removed. No action was taken.';
  const identity = await pageIdentity(page.tabId).catch(() => null);
  if (!identity || identity.nonce !== page.documentNonce || identity.href !== page.url) {
    return 'The page changed since you started speaking. No action was taken.';
  }
  return null;
}

async function begin() {
  if (recording || finishing) return;
  try {
    const tab = await focusedHttpTab();
    if (!(await siteEnabled(tab.origin))) { say('Enable this website before recording.'); return; }
    const userId = input('user').value.trim();
    const token = input('code').value.trim();
    if (!userId || !token || !input('profile').value.trim()) { say('Enter your user ID, personal access token, and profile UUID first.'); return; }
    const identity = await pageIdentity(tab.tabId);
    if (!identity || identity.href !== tab.url) { say('Could not identify this page. No recording was kept.'); return; }
    bound = { tabId: tab.tabId, origin: tab.origin, url: tab.url, documentNonce: identity.nonce, userId, token };
    stopSpeaking();
    silenceBtn.disabled = true;
    const maxDurationMs = clampClipMs(Number(input('maxsec').value) * 1000);
    const autoStop = input('autostop').checked;
    recording = await startRecording({ maxDurationMs, autoStop, onAutoStop: () => { void finish(); } });
    syncButtons();
    say(autoStop
      ? `Listening, because you pressed the button. It stops after ${maxDurationMs / 1000} seconds, or when you stop it.`
      : 'Listening, because you pressed the button. Select Stop when the command is finished.');
  } catch (e) { recording = null; bound = null; syncButtons(); say('Unable to access microphone: ' + String(e)); }
}

async function finish() {
  const current = recording;
  const page = bound;
  if (!current || finishing || !page) return;
  finishing = true;
  recording = null;
  bound = null;
  syncButtons();
  try {
    say('Processing your recording…');
    const audio = await current.stop();
    const form = new FormData();
    form.append('audio', audio, 'speech.wav');
    form.append('profile_id', input('profile').value.trim());
    form.append('language', 'en-KE'); // Model can recognize enrolled commands from either language; language hint is advisory.
    const url = new URL('/api/recognize', input('api').value.trim());
    const response = await fetch(url, { method: 'POST', body: form, headers: { 'x-sauti-user': page.userId, 'x-sauti-user-token': page.token } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.detail || `HTTP ${response.status}`);
    if (!validRecognition(data)) throw new Error('Unexpected inference response.');
    const phrase = commandToUtterance(data);
    if (!phrase) { say(`Command rejected. ${data.reason || 'Not confident enough.'} Nothing was spoken.`); return; }
    const mismatch = await bindingStillValid(page);
    if (mismatch) { say(mismatch); return; }
    await chrome.scripting.executeScript({ target: { tabId: page.tabId }, files: ['content.js'] });
    const reply = await chrome.tabs.sendMessage(page.tabId, {
      kind: 'SAUTI_APPROVED_COMMAND', utterance: phrase, documentNonce: page.documentNonce,
    });
    const feedback = String(reply?.feedback || reply?.reason || 'The website did not acknowledge the command.');
    say(feedback);
    if (!reply?.ok) return;
    if (isReadAloudUtterance(phrase) && reply.feedback) speakReadAloud(feedback);
  } catch (e) { say('Command not executed: ' + String(e)); }
  finally { finishing = false; syncButtons(); }
}

recordBtn.addEventListener('click', () => { if (recording && toggleMode()) void finish(); else void begin(); });
stopBtn.addEventListener('click', () => { void finish(); });
silenceBtn.addEventListener('click', () => { stopSpeaking(); silenceBtn.disabled = true; });
document.getElementById('listen')!.addEventListener('change', syncButtons);
syncButtons();

async function loadSavedSettings() {
  const stored = await chrome.storage.local.get(['profileId', 'apiOrigin']);
  if (typeof stored.profileId === 'string') input('profile').value = stored.profileId;
  if (typeof stored.apiOrigin === 'string') input('api').value = stored.apiOrigin;
}
void loadSavedSettings();
void renderEnabled();
input('profile').addEventListener('change', () => { void chrome.storage.local.set({ profileId: input('profile').value.trim() }); });
input('api').addEventListener('change', () => { void chrome.storage.local.set({ apiOrigin: input('api').value.trim() }); });
