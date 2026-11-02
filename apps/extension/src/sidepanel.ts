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

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) {
    throw new Error('Open a regular HTTP or HTTPS website. Browser internal pages are protected.');
  }
  return { tabId: tab.id, origin: new URL(tab.url).origin };
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
    const { origin } = await activeTab();
    const already = await chrome.permissions.contains({ origins: [origin + '/*'] });
    const permitted = already || await chrome.permissions.request({ origins: [origin + '/*'] });
    if (!permitted) { say('Permission denied. No actions will be run.'); return; }
    await rememberOrigin(origin, true);
    say(`Enabled ${origin}. The microphone stays off until you start it.`);
  } catch (e) { say(String(e)); }
});

input('disable').addEventListener('click', async () => {
  try {
    const { origin } = await activeTab();
    await rememberOrigin(origin, false);
    say(`Disabled ${origin}. Commands will not run on this website.`);
  } catch (e) { say(String(e)); }
});

input('test-scroll').addEventListener('click', () => { void executeOnTab('scroll down'); });

async function executeOnTab(utterance: string) {
  const { tabId, origin } = await activeTab();
  if (!(await siteEnabled(origin))) { say(`Access to ${origin} is not granted. Select Enable current website.`); return; }
  // Inject the bundle into the page's isolated extension world. Do not inject ML outputs into page JS.
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const reply = await chrome.tabs.sendMessage(tabId, { kind: 'SAUTI_APPROVED_COMMAND', utterance });
  const feedback = String(reply?.feedback || reply?.reason || 'The website did not acknowledge the command.');
  say(feedback);
  if (!isReadAloudUtterance(utterance) || reply?.ok === false || !reply?.feedback) return;
  const started = speakText(String(reply.feedback), 'en-KE', {
    onend: () => { silenceBtn.disabled = true; },
    onerror: () => { silenceBtn.disabled = true; },
  });
  silenceBtn.disabled = !started;
  if (!started) say(feedback + ' Speech playback is unavailable in this panel. The text was not recorded or uploaded.');
}

async function begin() {
  if (recording || finishing) return;
  try {
    const { origin } = await activeTab();
    if (!(await siteEnabled(origin))) { say('Enable this website before recording.'); return; }
    if (!input('user').value.trim() || !input('code').value.trim() || !input('profile').value.trim()) { say('Enter your user ID, personal access token, and profile UUID first.'); return; }
    stopSpeaking();
    silenceBtn.disabled = true;
    const maxDurationMs = clampClipMs(Number(input('maxsec').value) * 1000);
    const autoStop = input('autostop').checked;
    recording = await startRecording({ maxDurationMs, autoStop, onAutoStop: () => { void finish(); } });
    syncButtons();
    say(autoStop
      ? `Listening, because you pressed the button. It stops after ${maxDurationMs / 1000} seconds, or when you stop it.`
      : 'Listening, because you pressed the button. Select Stop when the command is finished.');
  } catch (e) { recording = null; syncButtons(); say('Unable to access microphone: ' + String(e)); }
}

async function finish() {
  const current = recording;
  if (!current || finishing) return;
  finishing = true;
  recording = null;
  syncButtons();
  try {
    say('Processing your recording…');
    const audio = await current.stop();
    const form = new FormData();
    form.append('audio', audio, 'speech.wav');
    form.append('profile_id', input('profile').value.trim());
    form.append('language', 'en-KE'); // Model can recognize enrolled commands from either language; language hint is advisory.
    const url = new URL('/api/recognize', input('api').value.trim());
    const response = await fetch(url, { method: 'POST', body: form, headers: { 'x-sauti-user': input('user').value.trim(), 'x-sauti-user-token': input('code').value.trim() } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.detail || `HTTP ${response.status}`);
    if (!validRecognition(data)) throw new Error('Unexpected inference response.');
    const phrase = commandToUtterance(data);
    if (!phrase) { say(`Command rejected. ${data.reason || 'Not confident enough.'}`); return; }
    await executeOnTab(phrase);
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
