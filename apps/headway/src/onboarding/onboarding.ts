// Headway voice onboarding, in the side panel (design: design/voice-onboarding.html).
//
// 1 Welcome · 2 Consent · 3 Mic and room · 4 Trigger · 5 Pace · 6 Words ·
// 7 Record (3 takes per command; take 3 is held out) · Rest · 8 Answers · 9 Results.
//
// Every take is saved to IndexedDB before it is scored, and progress is saved to
// chrome.storage.local after every step, so closing the panel loses nothing and
// she never says a take twice. At the end, her measurements and choices go into her
// AI4A11y toolkit profile at `fields.voice`.

import { analyseTake, frameLevels, noiseFloorDb, HOP_MS, type TakeAnalysis } from '../voice/analysis.ts';
import { buildVoiceProfile, deriveListening, describeProfile, type VoiceSetup } from '../voice/profile.ts';
import {
  COMMAND_DEFS, phrasesFor, markWords, matchCommand, learnAlias, normalize, type ChosenCommand, type Lang,
} from '../voice/commands.ts';
import { MicRecorder } from '../voice/recorder.ts';
import { saveTake, listTakes, toPcm16, fromPcm16 } from '../voice/takes.ts';
import { sautiAvailable, sautiTranscribe, StandardListener, standardSupported, type Reading } from '../voice/readers.ts';
import { saveVoiceProfile } from '../voice/store.ts';
import { getLibrarian } from '../voice/toolkit-host.ts';

// ---------------------------------------------------------------- state

const DRAFT_KEY = 'headwayVoiceDraft';
const TAKES_PER_COMMAND = 3;
const REST_EVERY = 3;                 // commands between breaks
const PACE_SENTENCE: Record<'en' | 'sw', string> = {
  en: 'Open the Certificate of Good Conduct page',
  sw: 'Fungua ukurasa wa cheti cha maadili mema',
};
const STANDARD_CUT_MS = 800;          // a typical fixed end-of-speech wait, for the picture

interface HeldOut { id: string; sauti: boolean | null; standard: boolean | null; tuned: boolean | null; heard: string }

interface Draft {
  session: string;
  section: string;
  helperMode: boolean;
  consent: VoiceSetup['consent'];
  microphone: string;
  deviceId: string;
  roomFloorDb: number | null;
  trigger: VoiceSetup['trigger'];
  lang: Lang;
  suggestedWaitMs: number;
  waitMs: number;
  commands: ChosenCommand[];
  cmdIndex: number;
  take: number;                       // 1..3
  heldOut: HeldOut[];
  feedback: VoiceSetup['feedback'];
  confirm: VoiceSetup['confirm'];
  retakeOnly: string | null;          // re-recording one held-out take from the results
}

const fresh = (): Draft => ({
  session: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  section: 's-welcome', helperMode: false,
  consent: { record: false, trainPersonalModel: false, compareStandard: false, at: '' },
  microphone: '', deviceId: '', roomFloorDb: null,
  trigger: { kind: 'key', finish: 'pause' },
  lang: 'both', suggestedWaitMs: 2400, waitMs: 2400,
  commands: [], cmdIndex: 0, take: 1, heldOut: [],
  feedback: 'speech', confirm: 'forms', retakeOnly: null,
});

let d: Draft = fresh();
const mic = new MicRecorder();
let sautiUp = false;
let lastTake: Float32Array | null = null;
const liveLevels: number[] = [];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`onboarding: #${id} missing`);
  return el as T;
};
const radio = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
const setRadio = (name: string, value: string) => {
  const el = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const ICON = (id: string) => `<svg class="ico"><use href="#${id}"/></svg>`;

async function saveDraft() {
  await chrome.storage.local.set({ [DRAFT_KEY]: d });
}

// ---------------------------------------------------------------- navigation

function go(section: string) {
  d.section = section;
  for (const s of document.querySelectorAll<HTMLElement>('.stp')) s.hidden = s.id !== section;
  const sec = $(section);
  const n = Number(sec.dataset.step || 1);
  $('step-count').textContent = `${n} / 9`;
  $('progress').innerHTML = Array.from({ length: 9 }, (_, i) => `<i class="${i + 1 < n ? 'done' : i + 1 === n ? 'now' : ''}"></i>`).join('');
  sec.querySelector<HTMLElement>('h1, .say')?.focus();
  window.scrollTo(0, 0);
  void saveDraft();
}

function status(id: string, icon: string, text: string, live = false) {
  const el = $(id);
  el.innerHTML = `${ICON(icon)}<span>${esc(text)}</span>`;
  el.classList.toggle('is-live', live);
}

// ---------------------------------------------------------------- waves

function drawWave(el: HTMLElement, levels: readonly number[], bars = 60) {
  const slice = levels.slice(-bars);
  const pad = Array(Math.max(0, bars - slice.length)).fill(-90);
  const all = [...pad, ...slice];
  const max = el.clientHeight || 56;
  el.innerHTML = all.map((db) => `<i style="height:${Math.max(3, Math.min(max, ((db + 75) / 60) * max))}px"></i>`).join('');
}

mic.onLevel = ({ db }) => {
  liveLevels.push(db);
  if (liveLevels.length > 200) liveLevels.shift();
  onLiveLevel?.(db);
};
let onLiveLevel: ((db: number) => void) | null = null;

// ---------------------------------------------------------------- microphone

async function ensureMic(): Promise<boolean> {
  if (mic.isOpen) return true;
  try {
    d.microphone = await mic.open(d.deviceId || undefined);
    d.deviceId = mic.deviceId;
    await fillMicList();
    return true;
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'SecurityError') {
      // A side panel cannot show Chrome's permission prompt. Ask once in a tab.
      status('room-status', 'i-wait', 'Allow the microphone in the tab that just opened, then come back.', true);
      const granted = await askInTab();
      if (!granted) return false;
      return ensureMic();
    }
    status('room-status', 'i-wait', `Could not open the microphone (${name || 'error'}).`, true);
    return false;
  }
}

function askInTab(): Promise<boolean> {
  return new Promise((resolve) => {
    const listener = (msg: { type?: string; granted?: boolean }) => {
      if (msg?.type === 'HEADWAY_MIC_PERMISSION') {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(!!msg.granted);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    void chrome.tabs.create({ url: chrome.runtime.getURL('dist/mic-permission.html') });
  });
}

async function fillMicList() {
  const select = $<HTMLSelectElement>('mic-select');
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind === 'audioinput');
  select.innerHTML = devices.map((x) => `<option value="${esc(x.deviceId)}"${x.deviceId === d.deviceId ? ' selected' : ''}>${esc(x.label || 'Microphone')}</option>`).join('');
}

$<HTMLSelectElement>('mic-select').addEventListener('change', async (e) => {
  d.deviceId = (e.target as HTMLSelectElement).value;
  mic.close();
  await ensureMic();
  void measureRoom();
});

// ---------------------------------------------------------------- one recording

let active: { stop: () => void } | null = null;
let speakBtn: HTMLButtonElement | null = null;

function setSpeak(btn: HTMLButtonElement, mode: 'idle' | 'listening' | 'busy', title?: string, sub?: string) {
  btn.classList.toggle('listening', mode === 'listening');
  btn.disabled = mode === 'busy';
  const t = btn.querySelector('[data-title]'), s = btn.querySelector('[data-sub]');
  if (t) t.textContent = title ?? (mode === 'listening' ? "I'm listening" : mode === 'busy' ? 'Working…' : 'Start speaking');
  if (s) s.textContent = sub ?? (mode === 'listening' ? (d.trigger.finish === 'pause' ? `Stops after ${secs(d.waitMs)} of quiet, or press to finish` : 'Press again when you finish') : triggerHint());
}

function triggerHint() {
  if (d.trigger.kind === 'key') return 'Alt + Shift + H, Space, or tap';
  if (d.trigger.kind === 'switch') return 'Your switch, Space, or tap';
  return 'Tap, or press Space';
}

/**
 * Record until she finishes: her end-of-speech wait after speech (if she chose
 * "when I stop talking"), or a press. Returns 16 kHz samples.
 */
function capture(opts: { waitMs: number; onTick?: (quietMs: number) => void; withStandard?: StandardListener | null }): Promise<Float32Array> {
  return new Promise((resolve) => {
    const floor = d.roomFloorDb ?? -60;
    let heard = false, quietMs = 0, last = performance.now();
    const started = last;
    liveLevels.length = 0;
    const finish = async () => {
      onLiveLevel = null; active = null;
      resolve(await mic.stop());
    };
    onLiveLevel = (db) => {
      const now = performance.now(), dt = now - last; last = now;
      if (db >= floor + 10) { heard = true; quietMs = 0; } else if (db < floor + 6) quietMs += dt;
      opts.onTick?.(heard ? quietMs : 0);
      const elapsed = now - started;
      const autoStop = d.trigger.finish === 'pause' && heard && quietMs >= opts.waitMs;
      if (autoStop || (!heard && elapsed > 20000) || elapsed > 60000) void finish();
    };
    active = { stop: () => void finish() };
    mic.start();
  });
}

// ---------------------------------------------------------------- 1 Welcome

$('btn-helper').addEventListener('click', () => {
  d.helperMode = !d.helperMode;
  $('helper-tag').hidden = !d.helperMode;
  $('btn-helper').textContent = d.helperMode ? 'Helper mode on: the person speaks, you press' : 'Someone is helping me set up';
});

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-go]')) {
  b.addEventListener('click', () => go(`s-${{ 2: 'consent' }[Number(b.dataset.go)] ?? 'consent'}`));
}

// ---------------------------------------------------------------- 2 Consent

const syncAgree = () => { $<HTMLButtonElement>('btn-agree').disabled = !$<HTMLInputElement>('c-record').checked; };
$('c-record').addEventListener('change', syncAgree);
if (!standardSupported()) {
  const c = $<HTMLInputElement>('c-standard');
  c.disabled = true;
  c.closest('label')!.querySelector('small')!.textContent = 'Not available in this browser.';
}

$('btn-agree').addEventListener('click', () => {
  d.consent = {
    record: true,
    trainPersonalModel: $<HTMLInputElement>('c-train').checked,
    compareStandard: $<HTMLInputElement>('c-standard').checked,
    at: new Date().toISOString(),
  };
  go('s-room');
  void checkSauti();
});

$('btn-not-now').addEventListener('click', async () => {
  await chrome.storage.local.remove(DRAFT_KEY);
  location.href = 'sidepanel.html';
});

async function checkSauti() {
  sautiUp = await sautiAvailable();
  status('sauti-status', sautiUp ? 'i-check' : 'i-wait',
    sautiUp ? 'Sauti model connected' : 'Sauti model not reachable: start tools/voice-test (port 8790) to see its readings', sautiUp);
}

// ---------------------------------------------------------------- 3 Mic and room

let roomStage: 'mic' | 'room' | 'name' | 'done' = 'mic';

$('btn-room').addEventListener('click', async () => {
  if (roomStage === 'done') { go('s-trigger'); return; }
  if (!(await ensureMic())) return;
  void measureRoom();
});
$('btn-room-again').addEventListener('click', () => void measureRoom());

async function measureRoom() {
  roomStage = 'room';
  const btn = $<HTMLButtonElement>('btn-room');
  btn.disabled = true; btn.textContent = 'Stay quiet…';
  $('btn-room-again').hidden = true;
  $('name-label').hidden = true; $('name-card').hidden = true;
  status('room-status', 'i-wait', 'Listening to the room…', true);
  liveLevels.length = 0;
  onLiveLevel = () => drawWave($('room-wave'), liveLevels);
  mic.start();
  await new Promise((r) => setTimeout(r, 5000));
  onLiveLevel = null;
  const room = await mic.stop();
  d.roomFloorDb = noiseFloorDb(room);
  await saveTake({ at: new Date().toISOString(), language: d.lang, prompt: '', kind: 'room', pcm: toPcm16(room), session: d.session });
  const quiet = d.roomFloorDb < -50;
  status('room-status', quiet ? 'i-check' : 'i-wait', quiet ? 'Quiet room' : 'Some background sound. Headway will allow for it.', true);

  // Then a word, to check her voice comes through clearly.
  roomStage = 'name';
  $('name-label').hidden = false; $('name-card').hidden = false;
  status('name-status', 'i-mic', 'Listening… say your name, or any word', true);
  $('name-len').textContent = '';
  btn.textContent = 'Listening…';
  if (!mic.isOpen) await ensureMic();
  const takeLevels: number[] = [];
  const sample = await new Promise<Float32Array>((resolve) => {
    const floor = d.roomFloorDb ?? -60;
    let heard = false, quiet = 0, last = performance.now();
    const t0 = last;
    liveLevels.length = 0;
    onLiveLevel = (db) => {
      takeLevels.push(db);
      drawWave($('name-wave'), liveLevels);
      const now = performance.now(), dt = now - last; last = now;
      if (db >= floor + 10) { heard = true; quiet = 0; } else quiet += dt;
      if ((heard && quiet > 1200) || now - t0 > 10000) { onLiveLevel = null; void mic.stop().then(resolve); }
    };
    mic.start();
  });
  const a = analyseTake(sample, d.roomFloorDb ?? undefined);
  if (a.speech.length) {
    status('name-status', 'i-check', a.speechDb !== null && a.speechDb < -42 ? 'Heard you, quietly. Moving closer will help.' : 'Heard you clearly', true);
    $('name-len').textContent = secs(a.speechMs);
  } else {
    status('name-status', 'i-wait', "Didn't hear a word. Measure again, a little closer to the microphone.", true);
  }
  roomStage = 'done';
  btn.disabled = false; btn.textContent = 'Next';
  $('btn-room-again').hidden = false;
  btn.focus();
  void saveDraft();
}

// ---------------------------------------------------------------- 4 Trigger

let learningSwitch = false;
document.querySelectorAll<HTMLInputElement>('input[name="trigger"]').forEach((r) => r.addEventListener('change', () => {
  d.trigger.kind = r.value as VoiceSetup['trigger']['kind'];
  learningSwitch = r.value === 'switch' && !d.trigger.switchCode;
  if (learningSwitch) $('switch-label').textContent = 'Press your switch now…';
}));
document.querySelectorAll<HTMLInputElement>('input[name="finish"]').forEach((r) => r.addEventListener('change', () => {
  d.trigger.finish = r.value as 'pause' | 'press';
}));
$('btn-trigger').addEventListener('click', () => {
  d.trigger.kind = radio('trigger') as VoiceSetup['trigger']['kind'];
  d.trigger.finish = radio('finish') as 'pause' | 'press';
  preparePace();
  go('s-pace');
});
void chrome.commands?.getAll?.().then((cmds) => {
  const c = cmds.find((x) => x.name === 'voice-trigger');
  if (c?.shortcut) $('key-label').textContent = `${c.shortcut.split('+').join(' + ')}. Press again to finish.`;
  else if (c) $('key-label').textContent = 'No key set yet: choose one at chrome://extensions/shortcuts.';
});

// ---------------------------------------------------------------- 5 Pace

let paceSamples: Float32Array | null = null;

function preparePace() {
  const sentence = d.lang === 'sw' ? PACE_SENTENCE.sw : PACE_SENTENCE.en;
  $('pace-sentence').textContent = sentence;
  setSpeak(paceBtn(), 'idle');
}
const paceBtn = () => document.querySelector<HTMLButtonElement>('[data-speak="pace"]')!;

async function runPace() {
  if (!(await ensureMic())) return;
  const btn = paceBtn();
  setSpeak(btn, 'listening', "I'm listening", 'Say the sentence; it stops after 6 seconds of quiet, or press');
  const samples = await capture({ waitMs: 6000 });
  setSpeak(btn, 'busy', 'Measuring…');
  const a = analyseTake(samples, d.roomFloorDb ?? undefined);
  if (!a.speech.length) {
    setSpeak(btn, 'idle', 'Try again', "Didn't hear speech. A little closer, maybe?");
    return;
  }
  paceSamples = samples;
  await saveTake({ at: new Date().toISOString(), language: d.lang, prompt: $('pace-sentence').textContent || '', kind: 'speech', pcm: toPcm16(samples), session: d.session });
  const rule = deriveListening({ noiseDb: d.roomFloorDb ?? -60, speechDb: a.speechDb, pauses: a.pausesMs, onsets: [a.onsetMs ?? 0], speechMs: [a.speechMs] });
  d.suggestedWaitMs = Math.max(1000, Math.min(5000, rule.endOfSpeechMs));
  d.waitMs = d.suggestedWaitMs;
  drawPace(samples, a);
  const range = $<HTMLInputElement>('wait-range');
  range.value = String(d.waitMs);
  updateWait();
  $('pace-slider').hidden = false;
  $('btn-pace-keep').hidden = false;
  $('btn-pace-again').hidden = false;
  btn.hidden = true;
  const longest = a.pausesMs.length ? Math.max(...a.pausesMs) : 0;
  $('pace-lede').textContent = longest
    ? `Your longest pause was ${secs(longest)}. Here is where a standard listener stops, and where Headway waits.`
    : 'You said it in one go. Here is how long Headway will wait after you stop.';
  $('btn-pace-keep').focus();
}

function updateWait() {
  d.waitMs = Number($<HTMLInputElement>('wait-range').value);
  $('wait-value').textContent = secs(d.waitMs);
  $('btn-pace-keep').textContent = `Keep ${secs(d.waitMs)}`;
  if (paceSamples) drawPace(paceSamples, analyseTake(paceSamples, d.roomFloorDb ?? undefined));
}
$('wait-range').addEventListener('input', updateWait);
$('btn-pace-again').addEventListener('click', () => {
  $('pace-slider').hidden = true; $('btn-pace-keep').hidden = true; $('btn-pace-again').hidden = true; $('pace-diagram').hidden = true;
  paceBtn().hidden = false; setSpeak(paceBtn(), 'idle');
});
$('btn-pace-keep').addEventListener('click', () => { renderWords(); go('s-words'); });

/** Her own recording, drawn twice: cut at a fixed short wait, and at her wait. */
function drawPace(samples: Float32Array, a: TakeAnalysis) {
  const levels = frameLevels(samples);
  const first = a.speech[0], last = a.speech[a.speech.length - 1];
  const t0 = Math.max(0, first.startMs - 200);
  const tEnd = last.endMs + d.waitMs + 200;
  const W = 344, x = (ms: number) => ((ms - t0) / (tEnd - t0)) * W;
  // Standard listening stops at the first pause longer than its fixed wait.
  let cutMs = last.endMs + STANDARD_CUT_MS;
  for (let i = 1; i < a.speech.length; i++) {
    if (a.speech[i].startMs - a.speech[i - 1].endMs > STANDARD_CUT_MS) { cutMs = a.speech[i - 1].endMs + STANDARD_CUT_MS; break; }
  }
  const lost = cutMs < last.endMs;
  const bars = (y: number, cut: number | null) => {
    let out = '';
    for (let ms = t0; ms < last.endMs + 50; ms += 40) {
      const i = Math.round(ms / HOP_MS);
      const db = levels[Math.min(levels.length - 1, i)] ?? -90;
      const inSpeech = a.speech.some((s) => ms >= s.startMs && ms <= s.endMs);
      if (!inSpeech) continue;
      const h = Math.max(3, Math.min(30, ((db + 70) / 55) * 30));
      const ghost = cut !== null && ms > cut;
      out += `<rect x="${x(ms).toFixed(1)}" y="${(y - h / 2).toFixed(1)}" width="2.4" height="${h.toFixed(1)}" rx="1.2" fill="${ghost ? 'var(--ghost-bar)' : 'var(--ink-bar)'}"/>`;
    }
    return out;
  };
  const longest = a.pausesMs.length ? Math.max(...a.pausesMs) : 0;
  const li = a.pausesMs.indexOf(longest);
  const gapStart = li >= 0 ? a.speech[li].endMs : 0, gapEnd = li >= 0 ? a.speech[li + 1].startMs : 0;
  $('pace-diagram').innerHTML = `<svg viewBox="0 0 ${W} 196" aria-hidden="true">
    <text x="0" y="22">STANDARD LISTENING</text>${bars(52, cutMs)}
    <line x1="0" y1="74" x2="${W}" y2="74" stroke="var(--line)"/>
    <line x1="${x(cutMs).toFixed(1)}" y1="14" x2="${x(cutMs).toFixed(1)}" y2="76" stroke="var(--fg)" stroke-width="1.3" stroke-dasharray="3 3"/>
    <text x="${Math.min(W - 120, x(cutMs) + 6).toFixed(1)}" y="88">stops after ${secs(STANDARD_CUT_MS)} quiet</text>
    ${lost ? `<text x="${Math.min(W - 110, x(cutMs) + 6).toFixed(1)}" y="22" font-style="italic">the rest is lost</text>` : ''}
    <text x="0" y="120">HEADWAY, YOUR PACE</text>${bars(150, null)}
    <line x1="0" y1="172" x2="${W}" y2="172" stroke="var(--line)"/>
    ${longest ? `<line x1="${x(gapStart).toFixed(1)}" y1="178" x2="${x(gapEnd).toFixed(1)}" y2="178" stroke="var(--muted)"/><text x="${x(gapStart).toFixed(1)}" y="190">${secs(longest)} pause kept</text>` : ''}
    <line x1="${x(last.endMs).toFixed(1)}" y1="150" x2="${(x(last.endMs + d.waitMs) - 4).toFixed(1)}" y2="150" stroke="var(--muted)" stroke-dasharray="2 3"/>
    <line x1="${x(last.endMs + d.waitMs).toFixed(1)}" y1="112" x2="${x(last.endMs + d.waitMs).toFixed(1)}" y2="174" stroke="var(--rule)" stroke-width="3" stroke-linecap="round"/>
    <text x="${Math.max(longest ? x(gapEnd) + 70 : 0, x(last.endMs + d.waitMs) - 110).toFixed(1)}" y="190">waits ${secs(d.waitMs)}, stops</text>
  </svg>`;
  $('pace-diagram').hidden = false;
}

// ---------------------------------------------------------------- 6 Words

const enabled = new Set(COMMAND_DEFS.filter((c) => c.onByDefault).map((c) => c.id));
const ownPhrases: Record<string, string[]> = {};

function renderWords() {
  setRadio('lang', d.lang);
  const list = $('cmd-list');
  list.innerHTML = COMMAND_DEFS.map((def) => {
    const phrases = [...(ownPhrases[def.id] ?? []), ...phrasesFor(def, d.lang)];
    const also = phrases.slice(1);
    return `<label class="cmd"><input type="checkbox" data-cmd="${def.id}"${enabled.has(def.id) ? ' checked' : ''}><span><b>${esc(phrases[0])}</b><small>${also.length ? 'also: ' + also.map((p) => `"${esc(p)}"`).join(', ') : 'one phrase'}</small></span><span class="toggle" aria-hidden="true"></span></label>`;
  }).join('');
  list.querySelectorAll<HTMLInputElement>('input[data-cmd]').forEach((i) => i.addEventListener('change', () => {
    if (i.checked) enabled.add(i.dataset.cmd!); else enabled.delete(i.dataset.cmd!);
    syncWordsButton();
  }));
  $('own-cmd').innerHTML = COMMAND_DEFS.map((def) => `<option value="${def.id}">${esc(def.en)}</option>`).join('');
  syncWordsButton();
}
function syncWordsButton() {
  const n = enabled.size;
  const b = $<HTMLButtonElement>('btn-words');
  b.disabled = n === 0;
  b.textContent = n ? `Record these · ${n} command${n === 1 ? '' : 's'}` : 'Choose at least one';
}
document.querySelectorAll<HTMLInputElement>('input[name="lang"]').forEach((r) => r.addEventListener('change', () => {
  d.lang = r.value as Lang; renderWords(); preparePace();
}));
$('btn-own').addEventListener('click', () => {
  const id = $<HTMLSelectElement>('own-cmd').value;
  const text = $<HTMLInputElement>('own-text').value.trim();
  if (!text) return;
  (ownPhrases[id] ??= []).unshift(text);
  enabled.add(id);
  $<HTMLInputElement>('own-text').value = '';
  renderWords();
});
$('btn-words').addEventListener('click', () => {
  d.commands = COMMAND_DEFS.filter((def) => enabled.has(def.id)).map((def) => ({
    id: def.id, phrases: [...(ownPhrases[def.id] ?? []), ...phrasesFor(def, d.lang)], aliases: [],
  }));
  d.cmdIndex = 0; d.take = 1; d.heldOut = [];
  renderRecord();
  go('s-record');
});

// ---------------------------------------------------------------- 7 Record

const recBtn = () => document.querySelector<HTMLButtonElement>('[data-speak="record"]')!;
const current = () => d.commands[d.cmdIndex];

function renderRecord() {
  const c = current();
  $('rec-label').textContent = d.retakeOnly ? 'Test again · say' : `Command ${d.cmdIndex + 1} of ${d.commands.length} · say`;
  $('rec-say').textContent = c.phrases[0];
  const also = c.phrases.slice(1);
  $('rec-also').hidden = !also.length;
  $('rec-also').textContent = also.length ? `or: ${also.join(' · ')}` : '';
  const dots = Array.from({ length: TAKES_PER_COMMAND }, (_, i) => `<i class="${i + 1 < d.take ? 'done' : ''}">${i + 1 < d.take ? ICON('i-check') : ''}</i>`).join('');
  const label = d.take === TAKES_PER_COMMAND ? 'last take: this one tests Headway' : `${d.take - 1} saved`;
  $('rec-takes').innerHTML = `${dots}<span>${label}</span>`;
  $('rec-live').hidden = true;
  setSpeak(recBtn(), 'idle', d.take === 1 ? 'Start speaking' : d.take === TAKES_PER_COMMAND ? 'Say it once more' : 'Say it again',
    d.take === TAKES_PER_COMMAND ? 'Last take for this command' : triggerHint());
}

async function runRecord() {
  if (!(await ensureMic())) return;
  const c = current();
  const btn = recBtn();
  const std = d.consent.compareStandard ? new StandardListener() : null;
  std?.start(d.lang === 'sw' ? 'sw' : 'en');
  $('rec-proof').hidden = true; $('rec-legend').hidden = true; $('rec-learned').hidden = true;
  $('rec-live').hidden = false;
  setSpeak(btn, 'listening');
  const samples = await capture({
    waitMs: d.waitMs,
    onTick: (q) => {
      drawWave($('rec-wave'), liveLevels, 74);
      $('rec-quiet').textContent = d.trigger.finish === 'pause' ? `quiet for ${secs(q)} of ${secs(d.waitMs)}` : 'press when you finish';
    },
  });
  $('rec-live').hidden = true;
  setSpeak(btn, 'busy', 'Writing it down…', sautiUp ? 'Sauti model' : 'Measuring');
  const standard: Reading | null = std ? await std.stop() : null;
  const a = analyseTake(samples, d.roomFloorDb ?? undefined);
  if (!a.speech.length) {
    $('rec-learned').hidden = false;
    $('rec-learned').textContent = "Headway didn't hear speech. Nothing was saved; try again, a little closer.";
    setSpeak(btn, 'idle', 'Try again');
    return;
  }
  lastTake = samples;
  $<HTMLButtonElement>('btn-hear').disabled = false;

  const sauti = await readSauti(samples, c);
  const takeNo = d.take;
  await saveTake({
    at: new Date().toISOString(), language: d.lang, prompt: c.phrases[0], kind: 'speech', pcm: toPcm16(samples),
    session: d.session, commandId: c.id, take: takeNo,
    sauti: sauti.ok ? sauti.text : undefined, standard: standard?.ok ? standard.text : undefined,
  });

  // Baseline = her phrases only. Tuned = phrases + what Headway learned from her earlier takes.
  const baseline = d.commands.map((x) => ({ ...x, aliases: [] }));
  const understood = (r: Reading | null, list: ChosenCommand[]) => (r && r.ok ? matchCommand(r.text, list) === c.id : null);
  const tunedOk = understood(sauti, d.commands);
  showReadings(c, standard, sauti, tunedOk, takeNo);

  if (takeNo === TAKES_PER_COMMAND) {
    const entry: HeldOut = { id: c.id, sauti: understood(sauti, baseline), standard: understood(standard, baseline), tuned: tunedOk, heard: sauti.ok ? sauti.text : '' };
    d.heldOut = [...d.heldOut.filter((h) => h.id !== c.id), entry];
  } else if (sauti.ok && !tunedOk) {
    const learned = learnAlias(d.commands, c.id, sauti.text);
    if (learned) {
      $('rec-learned').hidden = false;
      $('rec-learned').textContent = `Learned: when you say "${c.phrases[0]}", the model writes "${learned}". Headway will now take that as ${c.phrases[0]}.`;
    }
  }
  advance();
}

async function readSauti(samples: Float32Array, c: ChosenCommand): Promise<Reading> {
  if (!sautiUp) return { ok: false, reason: 'Sauti model not reachable' };
  if (d.lang === 'en') return sautiTranscribe(samples, 'english');
  if (d.lang === 'sw') return sautiTranscribe(samples, 'swahili');
  // Both: ask both models and keep the reading closer to one of her phrases.
  const [en, sw] = await Promise.all([sautiTranscribe(samples, 'english'), sautiTranscribe(samples, 'swahili')]);
  const score = (r: Reading) => (r.ok ? Math.max(...c.phrases.map((p) => similarity(p, r.text))) : -1);
  return score(sw) > score(en) ? sw : en;
}

function similarity(expected: string, got: string) {
  const marks = markWords(expected, got);
  const want = normalize(expected).split(' ').length;
  return marks.filter((m) => m.right).length / Math.max(want, marks.length || 1);
}

function showReadings(c: ChosenCommand, standard: Reading | null, sauti: Reading, tunedOk: boolean | null, takeNo: number) {
  const best = (text: string) => c.phrases.reduce((a, p) => (similarity(p, text) > similarity(a, text) ? p : a), c.phrases[0]);
  const row = (who: string, r: Reading | null, opts: { best?: boolean; textOverride?: string } = {}) => {
    if (!r) return '';
    if (!r.ok) return `<div class="reading"><span class="who">${who}</span><span class="words none">${esc(r.reason)}</span><span class="score"></span></div>`;
    const text = opts.textOverride ?? r.text;
    const target = best(text);
    const marks = markWords(target, text);
    const right = marks.filter((m) => m.right).length;
    const words = marks.length ? marks.map((m) => (m.right ? esc(m.word) : `<s>${esc(m.word)}</s>`)).join(' ') : '<span class="none">(nothing)</span>';
    return `<div class="reading${opts.best ? ' best' : ''}"><span class="who">${who}</span><span class="words">${words}</span><span class="score">${right} / ${normalize(target).split(' ').length}</span></div>`;
  };
  const tunedText = sauti.ok && tunedOk ? c.phrases[0] : sauti.ok ? sauti.text : '';
  $('proof-title').textContent = `What was heard · take ${takeNo}`;
  $('proof-rows').innerHTML =
    `<div class="reading"><span class="who">You said</span><span class="words">${esc(c.phrases[0])}</span><span class="score"></span></div>` +
    row('Standard', standard) +
    row('Sauti', sauti) +
    (sauti.ok ? row('Tuned', sauti, { best: !!tunedOk, textOverride: tunedText }) : '');
  $('rec-proof').hidden = false;
  $('rec-legend').hidden = false;
}

function advance() {
  const doneCommand = d.take >= TAKES_PER_COMMAND;
  if (d.retakeOnly) { d.retakeOnly = null; void showResults(); return; }
  if (!doneCommand) { d.take++; renderRecordKeepProof(); void saveDraft(); return; }
  d.cmdIndex++; d.take = 1;
  if (d.cmdIndex >= d.commands.length) { go('s-answers'); return; }
  if (d.cmdIndex % REST_EVERY === 0) { showRest(); return; }
  renderRecordKeepProof();
  void saveDraft();
}

/** Next prompt, but leave the last readings on screen so she can see what happened. */
function renderRecordKeepProof() {
  const keep = !$('rec-proof').hidden, learned = !$('rec-learned').hidden;
  renderRecord();
  $('rec-proof').hidden = !keep; $('rec-legend').hidden = !keep; $('rec-learned').hidden = !learned;
}

$('btn-skip').addEventListener('click', () => {
  if (active) return;
  d.take = TAKES_PER_COMMAND;
  advance();
});

$('btn-hear').addEventListener('click', () => {
  if (!lastTake) return;
  const ctx = new AudioContext({ sampleRate: 16000 });
  const buf = ctx.createBuffer(1, lastTake.length, 16000);
  buf.copyToChannel(new Float32Array(lastTake), 0);
  const src = ctx.createBufferSource();
  src.buffer = buf; src.connect(ctx.destination); src.start();
  src.onended = () => void ctx.close();
});

// ---------------------------------------------------------------- Rest

function showRest() {
  const total = d.commands.length * TAKES_PER_COMMAND;
  const done = d.cmdIndex * TAKES_PER_COMMAND;
  $('rest-ring').style.strokeDashoffset = String(364.4 * (1 - done / total));
  $('rest-lede').textContent = `${done} of ${total} takes are saved. Have some water. Nothing will be lost if you close this panel.`;
  go('s-rest');
}
$('btn-rest').addEventListener('click', () => { renderRecord(); go('s-record'); });
$('btn-later').addEventListener('click', async () => {
  await saveDraft();
  location.href = 'sidepanel.html';
});

// ---------------------------------------------------------------- 8 Answers

$('btn-hear-voice').addEventListener('click', (e) => {
  e.preventDefault();
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(d.lang === 'sw' ? 'Ninashuka chini.' : 'Scrolling down.'));
});
$('btn-answers').addEventListener('click', () => {
  d.feedback = radio('feedback') as VoiceSetup['feedback'];
  d.confirm = radio('confirm') as VoiceSetup['confirm'];
  void showResults();
});

// ---------------------------------------------------------------- 9 Results

function count(key: 'sauti' | 'standard' | 'tuned') {
  const rows = d.heldOut.filter((h) => h[key] !== null);
  return rows.length ? rows.filter((h) => h[key]).length : null;
}

async function showResults() {
  const n = d.heldOut.length;
  const tuned = count('tuned'), sauti = count('sauti'), standard = count('standard');
  $('res-big').textContent = tuned === null ? '–' : String(tuned);
  $('res-of').textContent = n ? `of your ${n} test command${n === 1 ? '' : 's'}` : 'no test takes yet';
  const bar = (label: string, v: number | null, cls: string, why: string) => v === null
    ? `<div class="bar-row"><span>${label}</span><span class="n">–</span><small style="grid-column:1/-1">${why}</small></div>`
    : `<div class="bar-row ${cls}"><span>${label}</span><span class="n">${v} / ${n}</span><div class="track"><div class="fill" style="width:${n ? (v / n) * 100 : 0}%"></div></div></div>`;
  $('res-bars').innerHTML =
    bar('Standard speech recognition', standard, '', d.consent.compareStandard ? 'No reading.' : 'Not compared: you chose not to send audio to Google.') +
    bar('Sauti model, before setup', sauti, 'mid', 'The Sauti model was not reachable.') +
    bar('Headway, tuned to you', tuned, 'you', 'The Sauti model was not reachable.');

  const tricky = d.heldOut.filter((h) => h.tuned === false);
  $('res-tricky').hidden = !tricky.length;
  $('res-tricky-rows').innerHTML = tricky.map((h) => {
    const c = d.commands.find((x) => x.id === h.id)!;
    return `<div class="reading"><span class="who">You said</span><span class="words">${esc(c.phrases[0])}</span><span class="score"></span></div>` +
      `<div class="reading"><span class="who">Heard</span><span class="words">${markWords(c.phrases[0], h.heard).map((m) => (m.right ? esc(m.word) : `<s>${esc(m.word)}</s>`)).join(' ') || '(nothing)'}</span><span class="score"></span></div>`;
  }).join('');
  const again = $<HTMLButtonElement>('btn-again');
  if (tricky.length) {
    const c = d.commands.find((x) => x.id === tricky[0].id)!;
    again.hidden = false;
    again.textContent = `Test "${c.phrases[0]}" again`;
    again.onclick = () => { d.retakeOnly = c.id; d.cmdIndex = d.commands.indexOf(c); d.take = TAKES_PER_COMMAND; renderRecord(); go('s-record'); };
  } else again.hidden = true;
  $('res-note').textContent = n ? `${n} command${n === 1 ? '' : 's'} is a small test. Headway keeps learning from your corrections.` : '';

  const profile = await buildProfile();
  $('res-lines').innerHTML = profile ? describeProfile(profile).map((l) => `<li>${esc(l)}</li>`).join('') : '';
  go('s-results');
}

async function buildProfile() {
  const stored = (await listTakes()).filter((t) => t.session === d.session);
  const room = stored.filter((t) => t.kind === 'room').pop();
  const speech = stored.filter((t) => t.kind === 'speech');
  if (!speech.length) return null;
  const { profile } = buildVoiceProfile({
    room: room ? fromPcm16(room.pcm) : null,
    takes: speech.map((t) => ({ samples: fromPcm16(t.pcm), expected: t.prompt })),
    language: d.lang, microphone: d.microphone,
  });
  profile.listening.endOfSpeechMs = d.waitMs; // her choice on the pace screen
  profile.setup = {
    helperMode: d.helperMode, consent: d.consent, trigger: d.trigger,
    commands: d.commands, feedback: d.feedback, confirm: d.confirm,
    suggestedEndOfSpeechMs: d.suggestedWaitMs,
    results: { heldOut: d.heldOut.length, standard: count('standard'), sauti: count('sauti'), tuned: count('tuned') },
  };
  return profile;
}

$('btn-finish').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('btn-finish');
  btn.disabled = true;
  try {
    const profile = await buildProfile();
    if (!profile) throw new Error('no takes were recorded');
    await saveVoiceProfile(await getLibrarian(), profile);
    await chrome.storage.local.remove(DRAFT_KEY);
    mic.close();
    location.href = 'sidepanel.html';
  } catch (err) {
    btn.disabled = false;
    $('save-status').hidden = false;
    $('save-status').textContent = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
  }
});

// ---------------------------------------------------------------- triggers

function trigger() {
  if (active) { active.stop(); return; }
  if (d.section === 's-pace' && !paceBtn().hidden && !paceBtn().disabled) void runPace();
  else if (d.section === 's-record' && !recBtn().disabled) void runRecord();
  else if (d.section === 's-trigger') { $('trigger-test').hidden = false; }
}

paceBtn().addEventListener('click', trigger);
recBtn().addEventListener('click', trigger);

chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === 'HEADWAY_VOICE_TRIGGER') trigger();
});

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  const typing = t instanceof HTMLInputElement && t.type === 'text' || t instanceof HTMLSelectElement;
  if (learningSwitch && !['Tab', 'Enter', 'Escape'].includes(e.code)) {
    e.preventDefault();
    d.trigger.switchCode = e.code;
    learningSwitch = false;
    $('switch-label').textContent = `Learned: your switch sends ${e.code}.`;
    return;
  }
  if (d.trigger.kind === 'switch' && d.trigger.switchCode && e.code === d.trigger.switchCode) { e.preventDefault(); trigger(); return; }
  if (e.code === 'Space' && !typing && (d.section === 's-pace' || d.section === 's-record' || active)) {
    e.preventDefault();
    if (!e.repeat) trigger();
    return;
  }
  if (e.key === 'Enter' && !typing && !(t instanceof HTMLButtonElement)) {
    const primary = [...$(d.section).querySelectorAll<HTMLButtonElement>('.p-foot .btn.primary')].find((b) => !b.hidden && !b.disabled);
    if (primary) { e.preventDefault(); primary.click(); }
  }
});

window.addEventListener('pagehide', () => { void saveDraft(); mic.close(); });

// ---------------------------------------------------------------- start / resume

void (async () => {
  const saved = (await chrome.storage.local.get(DRAFT_KEY))[DRAFT_KEY] as Draft | undefined;
  if (saved && saved.consent?.record) {
    d = { ...fresh(), ...saved };
    $('helper-tag').hidden = !d.helperMode;
    setRadio('trigger', d.trigger.kind); setRadio('finish', d.trigger.finish);
    setRadio('feedback', d.feedback); setRadio('confirm', d.confirm);
    $<HTMLInputElement>('wait-range').value = String(d.waitMs);
    void checkSauti();
    if (d.section === 's-record' || d.section === 's-rest') { renderRecord(); go('s-record'); return; }
    if (d.section === 's-words') { renderWords(); go('s-words'); return; }
    if (d.section === 's-pace') { preparePace(); go('s-pace'); return; }
    if (d.section === 's-answers') { go('s-answers'); return; }
    if (d.section === 's-results') { void showResults(); return; }
    go(d.section === 's-room' ? 's-room' : 's-trigger');
    return;
  }
  go('s-welcome');
})();
