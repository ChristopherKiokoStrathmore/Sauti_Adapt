import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RATE, analyseTake, frameLevels, detectSpeech, noiseFloorDb, yinPitch, finalContour,
} from '../src/voice/analysis.ts';
import { buildVoiceProfile, deriveListening, describeProfile } from '../src/voice/profile.ts';
import { saveVoiceProfile, loadVoiceProfile, clearVoiceProfile } from '../src/voice/store.ts';

// ---------------------------------------------------------------- synthetic voice

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
}

/** Room noise at about -60 dBFS. */
function noise(ms: number, seed = 7, amp = 0.0015): Float32Array {
  const r = rng(seed), out = new Float32Array(Math.round((ms / 1000) * RATE));
  for (let i = 0; i < out.length; i++) out[i] = r() * 2 * amp * 1.7;
  return out;
}

/** A voiced "word": harmonics of f0 (optionally gliding to f1) under a smooth envelope. */
function word(ms: number, f0: number, f1 = f0, amp = 0.2): Float32Array {
  const n = Math.round((ms / 1000) * RATE), out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = f0 + (f1 - f0) * (i / n);
    phase += (2 * Math.PI * f) / RATE;
    const env = Math.sin((Math.PI * i) / n) ** 0.5;
    out[i] = amp * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase)) / 1.75;
  }
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  // keep the room under the speech too
  const bed = noise((out.length / RATE) * 1000, 3);
  for (let i = 0; i < out.length; i++) out[i] += bed[i];
  return out;
}

const silence = (ms: number) => new Float32Array(Math.round((ms / 1000) * RATE));

// 0.8 s before she starts, then words with pauses of 0.4 s, 1.9 s and 0.6 s.
const take = concat(silence(800), word(350, 180), silence(400), word(300, 175), silence(1900), word(400, 170), silence(600), word(350, 165, 140), silence(1000));

// ---------------------------------------------------------------- analysis

test('the room floor is measured from a quiet recording', () => {
  const db = noiseFloorDb(noise(3000));
  assert.ok(db < -55 && db > -70, `floor ${db}`);
});

test('pauses inside the sentence are found and measured', () => {
  const a = analyseTake(take, noiseFloorDb(noise(3000)));
  assert.equal(a.speech.length, 4, JSON.stringify(a.speech));
  assert.equal(a.pausesMs.length, 3);
  const [p1, p2, p3] = a.pausesMs;
  for (const [got, want] of [[p1, 400], [p2, 1900], [p3, 600]]) {
    assert.ok(Math.abs(got - want) <= 120, `pause ${got} vs ${want}`);
  }
});

test('onset is the wait between the microphone opening and her first word', () => {
  const a = analyseTake(take, noiseFloorDb(noise(3000)));
  assert.ok(a.onsetMs !== null && Math.abs(a.onsetMs - 800) <= 80, `onset ${a.onsetMs}`);
});

test('gaps shorter than a pause are joined into one word', () => {
  const t = concat(silence(300), word(200, 150), silence(80), word(200, 150), silence(300));
  const levels = frameLevels(t);
  assert.equal(detectSpeech(levels, -60).length, 1);
});

test('pitch is tracked to within 3% of the true fundamental', () => {
  for (const f0 of [110, 180, 260]) {
    const w = word(400, f0);
    const hz = yinPitch(w, 2000);
    assert.ok(hz !== null && Math.abs(hz - f0) / f0 < 0.03, `${f0} → ${hz}`);
  }
});

test('a falling end of sentence reads as negative, a rising one as positive', () => {
  assert.ok((finalContour([...Array(30).fill(180), ...Array(10).fill(140)]) ?? 0) < -3);
  assert.ok((finalContour([...Array(30).fill(180), ...Array(10).fill(230)]) ?? 0) > 3);
});

test('digital silence is treated as a quiet room, not as -100 dB', () => {
  assert.equal(noiseFloorDb(new Float32Array(RATE * 2)), -70);
  const { profile } = buildVoiceProfile({ room: new Float32Array(RATE * 2), language: 'en', takes: [{ samples: take }] });
  assert.ok(profile.listening.speechThresholdDb >= -64, `threshold ${profile.listening.speechThresholdDb}`);
  assert.ok(profile.level.snrDb! < 60, `snr ${profile.level.snrDb}`);
});

test('silence alone yields no speech and no pitch', () => {
  const a = analyseTake(noise(2000), -60);
  assert.equal(a.speech.length, 0);
  assert.equal(a.pitchHz.length, 0);
  assert.equal(a.onsetMs, null);
});

// ---------------------------------------------------------------- profile

test('a profile waits past her longest pause, and says so in plain words', () => {
  const { profile } = buildVoiceProfile({
    room: noise(3000), language: 'en', microphone: 'Test mic', now: new Date('2026-11-07T12:00:00Z'),
    takes: [{ samples: take, expected: 'scroll down to the comments' }],
  });
  assert.equal(profile.takes, 1);
  assert.ok(profile.pauses.maxMs! >= 1780);
  assert.ok(profile.listening.endOfSpeechMs > profile.pauses.maxMs!, 'waits longer than her longest pause');
  assert.ok(profile.pitch.medianHz! > 150 && profile.pitch.medianHz! < 190, `pitch ${profile.pitch.medianHz}`);
  assert.ok(profile.notes.includes('few-takes'));
  assert.ok(describeProfile(profile).some((l) => l.includes('longest pause')));
  assert.ok(JSON.stringify(profile).length < 2000, 'small enough for chrome.storage.sync');
});

test('listening rules: clamped, and never closer than 6 dB to the room', () => {
  const quick = deriveListening({ noiseDb: -60, speechDb: -58, pauses: [], onsets: [0], speechMs: [1000] });
  assert.equal(quick.endOfSpeechMs, 800);
  assert.equal(quick.noSpeechTimeoutMs, 3000);
  assert.equal(quick.maxUtteranceMs, 8000);
  assert.equal(quick.speechThresholdDb, -54);
  const slow = deriveListening({ noiseDb: -60, speechDb: -20, pauses: [9000], onsets: [20000], speechMs: [200000] });
  assert.equal(slow.endOfSpeechMs, 6000);
  assert.equal(slow.noSpeechTimeoutMs, 15000);
  assert.equal(slow.maxUtteranceMs, 120000);
});

// ---------------------------------------------------------------- toolkit round trip

const vendor = join(dirname(fileURLToPath(import.meta.url)), '../../../vendor/ai4a11y-toolkit/toolkit');
const haveToolkit = existsSync(join(vendor, 'index.js'));

test('the profile is saved to and read from the real AI4A11y toolkit', { skip: !haveToolkit && 'run python scripts/bootstrap_toolkit.py' }, async () => {
  const { createToolkit } = await import('../../../vendor/ai4a11y-toolkit/toolkit/index.js');
  const { memoryKV } = await import('../../../vendor/ai4a11y-toolkit/toolkit/platforms/node/kv.js');
  const { datastore, librarian } = createToolkit({ kv: memoryKV() });
  await datastore.runMigrations();

  const { profile } = buildVoiceProfile({ room: noise(2000), language: 'sw', takes: [{ samples: take }] });
  await saveVoiceProfile(librarian, profile);
  assert.deepEqual(await loadVoiceProfile(librarian), profile);

  const whole = await librarian.getProfile();
  assert.deepEqual(whole?.fields?.voice, profile, 'stored at fields.voice in the toolkit profile');

  await clearVoiceProfile(librarian);
  assert.equal(await loadVoiceProfile(librarian), null);
});
