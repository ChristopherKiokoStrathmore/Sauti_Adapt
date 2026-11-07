// Side panel "Your voice" section: shows the saved voice profile, opens calibration,
// and lets the person forget the profile or delete the recordings.

import { loadVoiceProfile, clearVoiceProfile } from '../voice/store.ts';
import { getLibrarian } from '../voice/toolkit-host.ts';
import { countTakes, deleteAllTakes } from '../voice/takes.ts';
import type { VoiceProfile } from '../voice/profile.ts';

const PROFILE_KEY = 'aa.mine.profile'; // toolkit datastore key, chrome.storage.sync

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Headway side panel: #${id} is missing`);
  return node as T;
}

const s = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);

function setStatus(glyph: string, word: string, live: boolean) {
  const status = el('voice-status');
  status.querySelector('.glyph')!.textContent = glyph;
  el('voice-status-text').textContent = word;
  status.classList.toggle('is-live', live);
}

function render(profile: VoiceProfile | null, takes: number) {
  const lines = el<HTMLUListElement>('voice-lines');
  const btn = el<HTMLButtonElement>('voice-calibrate-btn');
  el('voice-delete-takes-btn').hidden = takes === 0;
  if (!profile) {
    setStatus('○', 'Not set up yet', false);
    lines.hidden = true;
    el('voice-manage').hidden = takes === 0;
    btn.textContent = 'Teach Headway my voice';
    return;
  }
  const date = new Date(profile.calibratedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  setStatus('✓', `Set up ${date} · ${profile.takes} sentences`, true);
  const rows = [
    `Waits <b>${s(profile.listening.endOfSpeechMs)}</b> after you stop`,
    `Longest pause <b>${s(profile.pauses.maxMs)}</b> · typical <b>${s(profile.pauses.medianMs)}</b>`,
    profile.pitch.medianHz !== null ? `Voice around <b>${profile.pitch.medianHz} Hz</b>, range <b>${profile.pitch.rangeSt ?? '—'} st</b>` : '',
    profile.pace.wordsPerMin !== null ? `Pace about <b>${profile.pace.wordsPerMin}</b> words a minute` : '',
  ].filter(Boolean);
  lines.innerHTML = rows.map((r) => `<li>${r}</li>`).join('');
  lines.hidden = false;
  el('voice-manage').hidden = false;
  btn.textContent = 'Calibrate again';
}

async function refresh() {
  try {
    const draft = (await chrome.storage.local.get('headwayVoiceDraft')).headwayVoiceDraft as { consent?: { record?: boolean } } | undefined;
    const [profile, takes] = await Promise.all([loadVoiceProfile(await getLibrarian()), countTakes().catch(() => 0)]);
    render(profile, takes);
    if (draft?.consent?.record) el('voice-calibrate-btn').textContent = 'Continue setting up my voice';
  } catch {
    setStatus('⚠', 'Could not read your profile', true);
  }
}

export function initVoicePanel() {
  el('voice-calibrate-btn').addEventListener('click', () => {
    location.href = 'onboarding.html';
  });
  el('voice-forget-btn').addEventListener('click', async () => {
    await clearVoiceProfile(await getLibrarian());
    await refresh();
  });
  el('voice-delete-takes-btn').addEventListener('click', async () => {
    await deleteAllTakes();
    await refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[PROFILE_KEY]) void refresh();
  });
  // Calibration saves recordings in its own tab; pick up the count when we come back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  void refresh();
}
