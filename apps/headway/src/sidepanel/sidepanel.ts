// Headway side panel: settings and summary display only. No AI logic lives here;
// the worker writes summaries and this view renders what it is sent.
import type { ApiChoice, ApiStatus, ApiStatusResponse, DisplayMode, RuntimeMessage } from '../shared/types';
import { HEAD_POINTER_ENABLED, SUMMARIES_ENABLED } from '../shared/features';
import { asSteadiness, clampSpeed } from '../gaze/motion';
import { initVoicePanel } from './voice-panel.ts';
import { initHeadwayAgent } from '../agent/panel.ts';

// Summaries are switched off for now (shared/features.ts): hide everything that belongs to them.
if (!HEAD_POINTER_ENABLED) {
  for (const el of document.querySelectorAll<HTMLElement>('[data-feature="head-pointer"]')) el.hidden = true;
}
if (!SUMMARIES_ENABLED) {
  for (const el of document.querySelectorAll<HTMLElement>('[data-feature="summaries"]')) el.hidden = true;
}

interface PanelSettings {
  apiChoice: ApiChoice;
  customPrompt: string;
  displayMode: DisplayMode;
  gazeEnabled: boolean;
  gazeDwellMs: number;
}

const settings: PanelSettings = {
  apiChoice: 'summarization',
  customPrompt: 'Summarize this article in 2-3 sentences',
  displayMode: 'tooltip',
  gazeEnabled: false,
  gazeDwellMs: 600
};

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Headway side panel: #${id} is missing`);
  return el as T;
}

const ui = {
  topStatus: byId<HTMLParagraphElement>('top-status'),
  gazeEnabled: byId<HTMLInputElement>('gaze-enabled'),
  gazeStatus: byId<HTMLParagraphElement>('gaze-status'),
  calibrateBtn: byId<HTMLButtonElement>('calibrate-btn'),
  calibrateHint: byId<HTMLParagraphElement>('calibrate-hint'),
  dwellTime: byId<HTMLInputElement>('dwell-time'),
  dwellNumber: byId<HTMLSpanElement>('dwell-number'),
  pointerSpeed: byId<HTMLInputElement>('pointer-speed'),
  speedNumber: byId<HTMLSpanElement>('speed-number'),
  mouthEnabled: byId<HTMLInputElement>('mouth-click-enabled'),
  mouthStatus: byId<HTMLParagraphElement>('mouth-status'),
  calibrateMouthBtn: byId<HTMLButtonElement>('calibrate-mouth-btn'),
  trustedClicks: byId<HTMLInputElement>('trusted-clicks'),
  promptContainer: byId<HTMLDivElement>('prompt-container'),
  customPrompt: byId<HTMLTextAreaElement>('custom-prompt'),
  apiSummarizer: byId<HTMLElement>('api-summarizer'),
  apiPrompt: byId<HTMLElement>('api-prompt'),
  outputEmpty: byId<HTMLDivElement>('output-empty'),
  outputLoading: byId<HTMLDivElement>('output-loading'),
  loadingTitle: byId<HTMLParagraphElement>('loading-title'),
  outputContent: byId<HTMLElement>('output-content'),
  summaryHeading: byId<HTMLHeadingElement>('summary-heading'),
  aiSummary: byId<HTMLDivElement>('ai-summary')
};

/** Glyph + word. Colour never carries the state on its own. */
function setStatus(el: HTMLElement, glyph: string, word: string, tone: 'idle' | 'live' | 'warn' = 'idle') {
  const glyphEl = el.querySelector('.glyph');
  const wordEl = el.querySelector('.word');
  if (glyphEl) glyphEl.textContent = glyph;
  if (wordEl) wordEl.textContent = word;
  el.classList.toggle('is-live', tone === 'live');
  el.classList.toggle('is-warn', tone === 'warn');
}

async function withActiveTab(run: (tabId: number) => void | Promise<void>) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && typeof tab.id === 'number') await run(tab.id);
}

function sendToActiveTab(message: RuntimeMessage) {
  void withActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // content script not ready on this tab (e.g. chrome:// pages); nothing to do
    });
  });
}

async function saveSettings() {
  await chrome.storage.local.set({ ...settings });
}

// ---------- pointer status ----------

function updateGazeStatus(phase: string | undefined, note?: string | null) {
  const text = note ?? '';
  if (!settings.gazeEnabled || text.toLowerCase().includes('disabled')) {
    setStatus(ui.gazeStatus, '○', 'Off');
    setStatus(ui.topStatus, '○', 'Off');
    return;
  }
  if (/camera/i.test(text) && /reject|denied|blocked/i.test(text)) {
    setStatus(ui.gazeStatus, '⚠', 'Camera is blocked for this site. Allow it in the address bar, then reload.', 'warn');
    setStatus(ui.topStatus, '⚠', 'Camera blocked', 'warn');
    return;
  }
  switch (phase) {
    case 'loading':
      setStatus(ui.gazeStatus, '◌', text && text !== 'Initializing...' ? text : 'Loading face models…');
      setStatus(ui.topStatus, '◌', 'Starting');
      break;
    case 'calibrating':
      setStatus(ui.gazeStatus, '◷', 'Calibrating on the page');
      setStatus(ui.topStatus, '◷', 'Calibrating');
      break;
    case 'live':
      setStatus(ui.gazeStatus, '◉', text || 'Tracking your head', 'live');
      setStatus(ui.topStatus, '◉', 'Tracking', 'live');
      break;
    case 'ready':
      setStatus(ui.gazeStatus, '○', text || 'Ready to calibrate');
      setStatus(ui.topStatus, '○', 'Ready');
      break;
    default:
      setStatus(ui.gazeStatus, '○', text || 'Waiting for the page');
  }
}

function syncPointerControls() {
  ui.gazeEnabled.checked = settings.gazeEnabled;
  ui.calibrateBtn.disabled = !settings.gazeEnabled;
  ui.calibrateHint.hidden = settings.gazeEnabled;
}

function updateMouthStatus(calibrated: boolean) {
  if (calibrated) setStatus(ui.mouthStatus, '✓', 'Calibrated');
  else setStatus(ui.mouthStatus, '○', 'Not calibrated');
}

// ---------- on-device AI status ----------

function describeApi(status: ApiStatus | undefined): [string, string] {
  switch (status) {
    case 'available':
    case 'readily':
      return ['✓', 'Ready'];
    case 'downloadable':
      return ['↓', 'Downloads on first use'];
    case 'downloading':
      return ['◌', 'Downloading'];
    case 'initializing':
      return ['◌', 'Checking'];
    case 'unavailable':
      return ['—', 'Not on this device'];
    default:
      return ['—', 'Not in this Chrome'];
  }
}

async function refreshApiStatus() {
  try {
    const status: ApiStatusResponse | undefined = await chrome.runtime.sendMessage({ type: 'GET_API_STATUS' });
    const [sg, sw] = describeApi(status?.summarizer);
    const [pg, pw] = describeApi(status?.promptAPI);
    setStatus(ui.apiSummarizer, sg, sw);
    setStatus(ui.apiPrompt, pg, pw);
  } catch {
    setStatus(ui.apiSummarizer, '—', 'Worker not responding');
    setStatus(ui.apiPrompt, '—', 'Worker not responding');
  }
}

// ---------- output ----------

type OutputState = 'empty' | 'loading' | 'content';
function showOutput(state: OutputState) {
  ui.outputEmpty.hidden = state !== 'empty';
  ui.outputLoading.hidden = state !== 'loading';
  ui.outputContent.hidden = state !== 'content';
}

const panelShowsSummaries = () => settings.displayMode === 'panel' || settings.displayMode === 'both';

function showProcessing(title?: string) {
  if (!panelShowsSummaries()) return;
  ui.loadingTitle.textContent = title ? title : 'Reading the page…';
  showOutput('loading');
}

/** `html` is produced by formatAISummary, which escapes the model output first. */
function showSummary(html: string, title?: string) {
  if (!panelShowsSummaries()) return;
  if (title) ui.summaryHeading.textContent = title;
  else if (!ui.outputLoading.hidden) ui.summaryHeading.textContent = ui.loadingTitle.textContent ?? '';
  ui.aiSummary.innerHTML = html;
  showOutput('content');
}

// ---------- settings ----------

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    'apiChoice', 'customPrompt', 'displayMode', 'gazeEnabled', 'gazeDwellMs', 'mouthClickEnabled', 'mouthCalV1',
    'gazeSpeed', 'gazeSteadiness', 'trustedClicks'
  ]);
  ui.trustedClicks.checked = stored.trustedClicks !== false;
  const speed = clampSpeed(stored.gazeSpeed);
  ui.pointerSpeed.value = String(speed);
  ui.speedNumber.textContent = speed.toFixed(1);
  const steady = asSteadiness(stored.gazeSteadiness);
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="steadiness"]')) {
    input.checked = input.value === steady;
  }
  if (stored.apiChoice === 'summarization' || stored.apiChoice === 'prompt') settings.apiChoice = stored.apiChoice;
  if (typeof stored.customPrompt === 'string' && stored.customPrompt) settings.customPrompt = stored.customPrompt;
  if (stored.displayMode === 'tooltip' || stored.displayMode === 'panel' || stored.displayMode === 'both') {
    settings.displayMode = stored.displayMode;
  }
  if (typeof stored.gazeEnabled === 'boolean') settings.gazeEnabled = stored.gazeEnabled;
  if (typeof stored.gazeDwellMs === 'number') settings.gazeDwellMs = stored.gazeDwellMs;

  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="api-choice"]')) {
    input.checked = input.value === settings.apiChoice;
  }
  // "both" is a valid stored mode from Nutshell; the panel offers the two common ones.
  const modeForRadio = settings.displayMode === 'both' ? 'panel' : settings.displayMode;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="display-mode"]')) {
    input.checked = input.value === modeForRadio;
  }
  ui.customPrompt.value = settings.customPrompt;
  ui.dwellTime.value = String(settings.gazeDwellMs);
  ui.dwellNumber.textContent = String(settings.gazeDwellMs);
  ui.promptContainer.hidden = settings.apiChoice !== 'prompt';

  syncPointerControls();
  updateGazeStatus(settings.gazeEnabled ? 'loading' : undefined);

  const mouthEnabled = stored.mouthClickEnabled === true;
  ui.mouthEnabled.checked = mouthEnabled;
  ui.calibrateMouthBtn.disabled = !mouthEnabled;
  updateMouthStatus(!!stored.mouthCalV1);
}

function bindEvents() {
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="api-choice"]')) {
    input.addEventListener('change', () => {
      settings.apiChoice = input.value as ApiChoice;
      ui.promptContainer.hidden = settings.apiChoice !== 'prompt';
      void saveSettings();
    });
  }

  ui.customPrompt.addEventListener('input', () => {
    settings.customPrompt = ui.customPrompt.value;
    void saveSettings();
  });

  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="display-mode"]')) {
    input.addEventListener('change', () => {
      settings.displayMode = input.value as DisplayMode;
      void saveSettings();
      sendToActiveTab({ type: 'DISPLAY_MODE_CHANGED', displayMode: settings.displayMode });
    });
  }

  ui.gazeEnabled.addEventListener('change', () => {
    settings.gazeEnabled = ui.gazeEnabled.checked;
    void saveSettings();
    sendToActiveTab({ type: 'GAZE_ENABLED_CHANGED', gazeEnabled: settings.gazeEnabled });
    syncPointerControls();

    if (!settings.gazeEnabled) {
      updateGazeStatus(undefined, 'Disabled');
      return;
    }
    updateGazeStatus('loading', 'Starting the camera…');
    // Tabs opened before the extension loaded have no content scripts yet: reload once.
    void withActiveTab(async (tabId) => {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      } catch {
        updateGazeStatus('loading', 'Reloading the page to start…');
        setTimeout(() => chrome.tabs.reload(tabId), 300);
      }
    });
  });

  ui.calibrateBtn.addEventListener('click', () => {
    ui.calibrateBtn.blur(); // Space confirms calibration steps; keep it from re-pressing this button
    sendToActiveTab({ type: 'TRIGGER_CALIBRATION' });
  });

  ui.mouthEnabled.addEventListener('change', () => {
    const enabled = ui.mouthEnabled.checked;
    void chrome.storage.local.set({ mouthClickEnabled: enabled });
    ui.calibrateMouthBtn.disabled = !enabled;
  });

  ui.calibrateMouthBtn.addEventListener('click', () => {
    ui.calibrateMouthBtn.blur();
    sendToActiveTab({ type: 'TRIGGER_MOUTH_CALIBRATION' });
  });

  ui.trustedClicks.addEventListener('change', () => {
    void chrome.storage.local.set({ trustedClicks: ui.trustedClicks.checked });
  });

  ui.pointerSpeed.addEventListener('input', () => {
    const speed = clampSpeed(parseFloat(ui.pointerSpeed.value));
    ui.speedNumber.textContent = speed.toFixed(1);
    void chrome.storage.local.set({ gazeSpeed: speed });
  });

  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="steadiness"]')) {
    input.addEventListener('change', () => {
      void chrome.storage.local.set({ gazeSteadiness: asSteadiness(input.value) });
    });
  }

  ui.dwellTime.addEventListener('input', () => {
    const value = parseInt(ui.dwellTime.value, 10);
    settings.gazeDwellMs = value;
    ui.dwellNumber.textContent = String(value);
    void saveSettings();
  });
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  switch (message.type) {
    case 'STREAMING_UPDATE':
      showSummary(message.content ?? '');
      break;
    case 'PROCESSING_STATUS':
      if (message.status === 'started') showProcessing(message.title);
      break;
    case 'DISPLAY_CACHED_SUMMARY':
      showSummary(typeof message.summary === 'string' ? message.summary : '', message.title);
      break;
    case 'GAZE_STATUS':
      updateGazeStatus(message.phase, message.note);
      break;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.mouthCalV1) updateMouthStatus(!!changes.mouthCalV1.newValue);
  if (changes.gazeEnabled && typeof changes.gazeEnabled.newValue === 'boolean') {
    settings.gazeEnabled = changes.gazeEnabled.newValue;
    syncPointerControls();
    if (!settings.gazeEnabled) updateGazeStatus(undefined, 'Disabled');
  }
});

void (async () => {
  initVoicePanel();
  initHeadwayAgent();
  await loadSettings();
  bindEvents();
  showOutput('empty');
  if (SUMMARIES_ENABLED) await refreshApiStatus();
})();

export {};
