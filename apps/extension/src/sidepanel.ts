import { commandToUtterance, validRecognition } from '@sauti/shared';
import { startRecording, type RecordingSession } from '@sauti/shared/audio';

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const recordBtn = input('record') as HTMLButtonElement;
const stopBtn = input('stop') as HTMLButtonElement;
const status = document.getElementById('status')!;
let recording: RecordingSession | null = null;
function say(message: string) { status.textContent = message; }

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
  say(reply?.feedback || reply?.reason || 'The website did not acknowledge the command.');
}

recordBtn.addEventListener('click', async () => {
  if (recording) return;
  try {
    const { origin } = await activeTab();
    if (!(await siteAllowed(origin))) { say('Enable this website before recording.'); return; }
    if (!input('code').value.trim() || !input('profile').value.trim()) { say('Enter the access code and your private profile UUID first.'); return; }
    recording = await startRecording();
    recordBtn.disabled = true;
    stopBtn.disabled = false;
    say('Listening. Speak one command and select Stop.');
  } catch (e) { say('Unable to access microphone: ' + String(e)); }
});

stopBtn.addEventListener('click', async () => {
  const current = recording;
  if (!current) return;
  recording = null;
  stopBtn.disabled = true;
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
  finally { recordBtn.disabled = false; }
});

async function loadSavedSettings() {
  const stored = await chrome.storage.local.get(['profileId', 'apiOrigin']);
  if (typeof stored.profileId === 'string') input('profile').value = stored.profileId;
  if (typeof stored.apiOrigin === 'string') input('api').value = stored.apiOrigin;
}
void loadSavedSettings();
input('profile').addEventListener('change', () => { void chrome.storage.local.set({ profileId: input('profile').value.trim() }); });
input('api').addEventListener('change', () => { void chrome.storage.local.set({ apiOrigin: input('api').value.trim() }); });
