// Voice analysis: what one recording says about how a person speaks.
//
// Pure functions over 16 kHz mono Float32 samples. No DOM, no chrome.*, no
// dependencies, so the same code runs in the calibration page, in Node tests,
// and (later) in the AI4A11y toolkit as core/voice.js.
//
// It measures how someone speaks, never what is wrong with them: room noise,
// how loud and how steady the voice is, where the pauses fall and how long they
// last, how quickly speech starts after the microphone opens, syllable pace, and
// pitch (median, range, how the voice rises or falls at the end). Nothing here
// infers a diagnosis or an ability.

export const RATE = 16_000;
export const HOP = 160;          // 10 ms between frames
export const FRAME = 320;        // 20 ms analysis window
export const HOP_MS = (HOP / RATE) * 1000;

const SILENCE_DB = -100;
/**
 * The quietest room we believe. Digital silence (a muted or gated microphone) reads
 * -100 dB, and thresholds built on it would treat breath and hum as speech.
 */
export const MIN_FLOOR_DB = -70;
/** Gaps shorter than this are part of a word (stop consonants), not a pause. */
const MIN_PAUSE_MS = 150;
/** Bursts shorter than this, with silence either side, are clicks, not speech. */
const MIN_SEGMENT_MS = 60;
const PITCH_MIN_HZ = 60;
const PITCH_MAX_HZ = 500;
const PITCH_WINDOW = 640;        // 40 ms: two periods of a 60 Hz voice
const YIN_THRESHOLD = 0.15;
const YIN_ACCEPT = 0.3;

export interface Segment { startMs: number; endMs: number }

export interface TakeAnalysis {
  durationMs: number;
  noiseDb: number;              // the floor this take was measured against
  speech: Segment[];            // where the person was speaking
  onsetMs: number | null;       // microphone open → first speech
  speechMs: number;             // first speech → last speech
  voicedMs: number;             // time actually speaking, pauses excluded
  pausesMs: number[];           // every pause inside the speech, in order
  speechDb: number | null;      // median level while speaking (dBFS)
  speechRangeDb: number | null; // p90 − p10 of speaking frames: how much the level moves
  clippedPct: number;           // samples at full scale
  syllables: number;            // energy peaks while speaking
  syllablesPerSec: number | null;
  pitchHz: number[];            // F0 of every confidently pitched frame (10 ms apart)
  finalContourSt: number | null;// last quarter of the pitch track vs the rest, in semitones
}

// ---------------------------------------------------------------- helpers

export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, (p / 100) * (sorted.length - 1)));
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export const median = (values: readonly number[]) => percentile(values, 50);

export function semitones(hz: number, refHz: number): number {
  return 12 * Math.log2(hz / refHz);
}

/** Level of each 20 ms frame, 10 ms apart, in dBFS. */
export function frameLevels(samples: Float32Array): number[] {
  const out: number[] = [];
  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    let sum = 0;
    for (let i = start; i < start + FRAME; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / FRAME);
    out.push(rms > 1e-5 ? 20 * Math.log10(rms) : SILENCE_DB);
  }
  return out;
}

/** The room's level: the median of a recording made while nobody speaks. */
export function noiseFloorDb(samples: Float32Array): number {
  const levels = frameLevels(samples);
  return Math.max(median(levels) ?? SILENCE_DB, MIN_FLOOR_DB);
}

/** A floor taken from a speech recording itself: its quietest tenth. */
export function estimateFloorFromSpeech(levels: readonly number[]): number {
  return percentile(levels, 10) ?? SILENCE_DB;
}

// ---------------------------------------------------------------- speech / pauses

export interface SpeechOptions { onAboveFloorDb?: number; offAboveFloorDb?: number }

/**
 * Where the person speaks, by level with hysteresis: a frame starts speech when it
 * is `on` dB over the floor and speech continues until it drops below `off`.
 * Gaps shorter than MIN_PAUSE_MS are joined (they are inside words); isolated
 * bursts shorter than MIN_SEGMENT_MS are dropped (clicks, bumps).
 */
export function detectSpeech(levels: readonly number[], floorDb: number, opts: SpeechOptions = {}): Segment[] {
  const on = floorDb + (opts.onAboveFloorDb ?? 10);
  const off = floorDb + (opts.offAboveFloorDb ?? 6);
  const raw: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < levels.length; i++) {
    const db = levels[i];
    if (start < 0 && db >= on) start = i;
    else if (start >= 0 && db < off) { raw.push([start, i]); start = -1; }
  }
  if (start >= 0) raw.push([start, levels.length]);

  const minGap = Math.round(MIN_PAUSE_MS / HOP_MS);
  const merged: Array<[number, number]> = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && seg[0] - last[1] < minGap) last[1] = seg[1];
    else merged.push([seg[0], seg[1]]);
  }
  const minLen = Math.round(MIN_SEGMENT_MS / HOP_MS);
  return merged
    .filter(([a, b]) => b - a >= minLen)
    .map(([a, b]) => ({ startMs: a * HOP_MS, endMs: b * HOP_MS }));
}

export function pausesBetween(segments: readonly Segment[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < segments.length; i++) out.push(Math.round(segments[i].startMs - segments[i - 1].endMs));
  return out;
}

/**
 * Syllable nuclei: peaks of the smoothed level inside speech that stand at least
 * 3 dB above the dip before them. A rough count, but it needs no transcript.
 */
export function countSyllables(levels: readonly number[], segments: readonly Segment[]): number {
  const smooth = levels.map((_, i) => {
    let s = 0, n = 0;
    for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < levels.length) { s += levels[j]; n++; }
    return s / n;
  });
  let count = 0;
  const minDistance = 10; // 100 ms between nuclei
  for (const seg of segments) {
    const a = Math.round(seg.startMs / HOP_MS), b = Math.min(smooth.length, Math.round(seg.endMs / HOP_MS));
    let lastPeak = -minDistance, valley = Infinity, inSegment = 0;
    for (let i = a + 1; i < b - 1; i++) {
      valley = Math.min(valley, smooth[i]);
      const isPeak = smooth[i] >= smooth[i - 1] && smooth[i] > smooth[i + 1];
      if (isPeak && smooth[i] - valley >= 3 && i - lastPeak >= minDistance) {
        inSegment++; lastPeak = i; valley = smooth[i];
      }
    }
    // A short steady segment has no inner peak but is still at least one syllable.
    count += Math.max(inSegment, 1);
  }
  return count;
}

// ---------------------------------------------------------------- pitch

/** YIN fundamental-frequency estimate for one window, or null when unpitched. */
export function yinPitch(samples: Float32Array, start: number, size = PITCH_WINDOW): number | null {
  const minTau = Math.floor(RATE / PITCH_MAX_HZ);
  const maxTau = Math.min(Math.floor(RATE / PITCH_MIN_HZ), Math.floor(size / 2));
  if (start + size > samples.length) return null;
  const half = size - maxTau;
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const diff = samples[start + i] - samples[start + i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalised difference.
  let running = 0;
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      while (t + 1 <= maxTau && cmnd[t + 1] < cmnd[t]) t++;
      tau = t; break;
    }
  }
  if (tau < 0) {
    // No dip under the threshold: take the global minimum if it is clear enough.
    let best = minTau;
    for (let t = minTau; t <= maxTau; t++) if (cmnd[t] < cmnd[best]) best = t;
    if (cmnd[best] > YIN_ACCEPT) return null;
    tau = best;
  }
  // Parabolic interpolation around the dip.
  let refined = tau;
  if (tau > 1 && tau < maxTau) {
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) refined = tau + (a - c) / (2 * denom);
  }
  const hz = RATE / refined;
  return hz >= PITCH_MIN_HZ && hz <= PITCH_MAX_HZ ? hz : null;
}

/** Pitch of every frame inside speech; unpitched frames (consonants, breath) are skipped. */
export function pitchTrack(samples: Float32Array, segments: readonly Segment[]): number[] {
  const out: number[] = [];
  for (const seg of segments) {
    const a = Math.round((seg.startMs / 1000) * RATE);
    const b = Math.round((seg.endMs / 1000) * RATE);
    for (let start = a; start + PITCH_WINDOW <= b; start += HOP) {
      const hz = yinPitch(samples, start);
      if (hz !== null) out.push(hz);
    }
  }
  return removeOctaveJumps(out);
}

/** YIN sometimes locks onto half or double the true pitch; pull those frames back. */
function removeOctaveJumps(track: number[]): number[] {
  const mid = median(track);
  if (mid === null) return track;
  return track
    .map((hz) => (hz > mid * 1.8 ? hz / 2 : hz < mid / 1.8 ? hz * 2 : hz))
    .filter((hz) => hz >= PITCH_MIN_HZ && hz <= PITCH_MAX_HZ);
}

/** How the voice moves at the end: last quarter of the track vs the rest (+ rises, − falls). */
export function finalContour(track: readonly number[]): number | null {
  if (track.length < 12) return null;
  const cut = Math.floor(track.length * 0.75);
  const body = median(track.slice(0, cut));
  const end = median(track.slice(cut));
  if (body === null || end === null) return null;
  return semitones(end, body);
}

// ---------------------------------------------------------------- one take

export function analyseTake(samples: Float32Array, floorDb?: number): TakeAnalysis {
  const levels = frameLevels(samples);
  const noiseDb = Math.max(floorDb ?? estimateFloorFromSpeech(levels), MIN_FLOOR_DB);
  const speech = detectSpeech(levels, noiseDb);
  const durationMs = Math.round((samples.length / RATE) * 1000);

  let clipped = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= 0.99) clipped++;

  const speakingLevels: number[] = [];
  for (const seg of speech) {
    const a = Math.round(seg.startMs / HOP_MS), b = Math.round(seg.endMs / HOP_MS);
    for (let i = a; i < b && i < levels.length; i++) speakingLevels.push(levels[i]);
  }
  const voicedMs = Math.round(speech.reduce((sum, s) => sum + (s.endMs - s.startMs), 0));
  const syllables = countSyllables(levels, speech);
  const pitchHz = pitchTrack(samples, speech);
  const p10 = percentile(speakingLevels, 10), p90 = percentile(speakingLevels, 90);

  return {
    durationMs,
    noiseDb: round1(noiseDb),
    speech,
    onsetMs: speech.length ? Math.round(speech[0].startMs) : null,
    speechMs: speech.length ? Math.round(speech[speech.length - 1].endMs - speech[0].startMs) : 0,
    voicedMs,
    pausesMs: pausesBetween(speech),
    speechDb: roundOrNull(median(speakingLevels)),
    speechRangeDb: p10 !== null && p90 !== null ? round1(p90 - p10) : null,
    clippedPct: samples.length ? round2((clipped / samples.length) * 100) : 0,
    syllables,
    syllablesPerSec: voicedMs > 0 ? round2(syllables / (voicedMs / 1000)) : null,
    pitchHz,
    finalContourSt: roundOrNull(finalContour(pitchHz)),
  };
}

export function round1(n: number) { return Math.round(n * 10) / 10; }
export function round2(n: number) { return Math.round(n * 100) / 100; }
function roundOrNull(n: number | null) { return n === null ? null : round1(n); }
