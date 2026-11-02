import { commandToUtterance, validRecognition } from '@sauti/shared';
import { clampClipMs, startRecording, type RecordingSession } from '@sauti/shared/audio';
import { isReadAloudUtterance, speakText, stopSpeaking } from '@sauti/shared/speak';

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

async function siteAllowed(origin: string) {
  return chrome.permissions.contains({ origins: [origin + '/*'] });
}

input('grant').addEventListener('click', async () => {
  try {
    const { origin } = await activeTab();
    const permitted = await chrome.permissions.request({ origins: [origin + '/*'] });
    say(permitted ? `Enabled ${origin}. The microphone remains off until you start it.` : 'Permission denied. No actions will be run.');
  } catch (e) { say(String(e)); }
});

async function executeOnTab(utterance: string) {
  const { tabId, origin } = await activeTab();
  if (!(await siteAllowed(origin))) { say(`Access to ${origin} is not granted. Select Enable current website.`); return; }
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
    if (!(await siteAllowed(origin))) { say('Enable this website before recording.'); return; }
    if (!input('code').value.trim() || !input('profile').value.trim()) { say('Enter the access code and your private profile UUID first.'); return; }
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
    const response = await fetch(url, { method: 'POST', body: form, headers: { 'x-sauti-demo-code': input('code').value.trim() } });
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
input('profile').addEventListener('change', () => { void chrome.storage.local.set({ profileId: input('profile').value.trim() }); });
input('api').addEventListener('change', () => { void chrome.storage.local.set({ apiOrigin: input('api').value.trim() }); });
