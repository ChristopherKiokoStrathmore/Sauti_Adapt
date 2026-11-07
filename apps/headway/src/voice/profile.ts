// The voice profile: a few numbers about how one person speaks, built from their
// calibration takes, plus the listening settings Headway derives from them.
//
// Stored in the person's AI4A11y toolkit profile at `fields.voice` (see store.ts),
// which the toolkit keeps in chrome.storage.sync, so it follows them to every
// Chrome they sign into. It holds measurements and her onboarding choices (her
// commands and the words the model hears for them): no audio, no free speech, and
// nothing about a diagnosis. Kept well under sync storage's 8 KB per item.

import {
  analyseTake, median, percentile, round1, round2, semitones,
  type TakeAnalysis,
} from './analysis.ts';

export const VOICE_PROFILE_VERSION = 1;

export interface VoiceProfile {
  version: number;
  calibratedAt: string;              // ISO date-time
  language: 'en' | 'sw' | 'both';
  microphone: string;                // device label as the browser reports it, or ''
  takes: number;                     // takes the profile was built from
  room: { noiseDb: number };
  level: { speechDb: number | null; rangeDb: number | null; snrDb: number | null; clippedPct: number };
  pauses: { count: number; medianMs: number | null; p90Ms: number | null; maxMs: number | null };
  onset: { medianMs: number | null; maxMs: number | null };
  pace: { syllablesPerSec: number | null; wordsPerMin: number | null };
  pitch: {
    medianHz: number | null; p10Hz: number | null; p90Hz: number | null;
    rangeSt: number | null;          // p10 → p90, in semitones: how much the voice moves
    variabilitySt: number | null;    // spread around the median, in semitones
    finalContourSt: number | null;   // median end-of-sentence movement (+ rise, − fall)
  };
  listening: ListeningSettings;
  notes: VoiceNote[];
  /** What she chose during onboarding. Absent on a measurements-only profile. */
  setup?: VoiceSetup;
}

/** Her choices from onboarding. Each is her answer, never inferred. */
export interface VoiceSetup {
  helperMode: boolean;                       // someone helped her set up
  consent: { record: boolean; trainPersonalModel: boolean; compareStandard: boolean; at: string };
  trigger: { kind: 'key' | 'panel' | 'switch'; switchCode?: string; finish: 'pause' | 'press' };
  commands: Array<{ id: string; phrases: string[]; aliases: string[] }>;
  feedback: 'speech' | 'sound' | 'text';
  confirm: 'always' | 'forms' | 'never';
  suggestedEndOfSpeechMs: number;            // what her pace measured; listening holds her choice
  results?: { heldOut: number; standard: number | null; sauti: number | null; tuned: number | null };
}

/** How Headway listens to this person. Every value is something she can change later. */
export interface ListeningSettings {
  endOfSpeechMs: number;     // quiet this long after speech = she has finished
  noSpeechTimeoutMs: number; // give up if nothing is said for this long after the mic opens
  maxUtteranceMs: number;    // longest single command or sentence
  speechThresholdDb: number; // level that counts as her voice in this room
  minRms: number;            // same threshold as linear RMS, the form the speech server uses
}

export type VoiceNote = 'noisy-room' | 'quiet-input' | 'clipping' | 'few-pauses' | 'few-takes';

export interface CalibrationTake {
  samples: Float32Array;      // 16 kHz mono
  expected?: string;          // the sentence she was asked to say, if any
}

export interface CalibrationInput {
  room: Float32Array | null;  // a few seconds of quiet, or null to estimate from the takes
  takes: CalibrationTake[];
  language: VoiceProfile['language'];
  microphone?: string;
  now?: Date;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Listening settings from the measurements. Pure, so the rules are testable and visible. */
export function deriveListening(m: {
  noiseDb: number; speechDb: number | null; pauses: number[]; onsets: number[]; speechMs: number[];
}): ListeningSettings {
  // Wait past her long pauses, not her average ones: cutting her off mid-sentence is
  // the failure that costs most. With few pauses measured, use the longest one.
  const basis = m.pauses.length >= 5 ? percentile(m.pauses, 90)! : Math.max(0, ...m.pauses);
  const endOfSpeechMs = clamp(roundTo(basis * 1.25 + 400, 100), 800, 6000);

  const slowestStart = Math.max(0, ...m.onsets);
  const noSpeechTimeoutMs = clamp(roundTo(slowestStart + 2500, 100), 3000, 15000);

  const longest = Math.max(0, ...m.speechMs);
  const maxUtteranceMs = clamp(roundTo(longest * 1.5, 1000), 8000, 120000);

  // Halfway-ish between the room and her voice, never closer than 6 dB to the room.
  const gap = m.speechDb === null ? 12 : m.speechDb - m.noiseDb;
  const speechThresholdDb = round1(m.noiseDb + clamp(gap * 0.35, 6, 18));
  const minRms = Number(Math.pow(10, speechThresholdDb / 20).toPrecision(3));

  return { endOfSpeechMs, noSpeechTimeoutMs, maxUtteranceMs, speechThresholdDb, minRms };
}

export function buildVoiceProfile(input: CalibrationInput): { profile: VoiceProfile; analyses: TakeAnalysis[] } {
  const roomFloor = input.room ? analyseTake(input.room).noiseDb : null;
  const analyses = input.takes.map((t) => analyseTake(t.samples, roomFloor ?? undefined));
  const noiseDb = roomFloor ?? (median(analyses.map((a) => a.noiseDb)) ?? -60);

  const usable = analyses.filter((a) => a.speech.length > 0);
  const pauses = usable.flatMap((a) => a.pausesMs);
  const onsets = usable.map((a) => a.onsetMs ?? 0);
  const speechMs = usable.map((a) => a.speechMs);
  const pitch = usable.flatMap((a) => a.pitchHz);
  const pitchMedian = median(pitch);
  const speechDb = median(usable.map((a) => a.speechDb).filter((v): v is number => v !== null));
  const clippedPct = Math.max(0, ...analyses.map((a) => a.clippedPct));

  const wpm = input.takes
    .map((t, i) => (t.expected && analyses[i].speechMs > 0 ? words(t.expected) / (analyses[i].speechMs / 60000) : null))
    .filter((v): v is number => v !== null);

  const p10 = percentile(pitch, 10), p90 = percentile(pitch, 90);
  const variability = pitchMedian === null || pitch.length < 2 ? null
    : Math.sqrt(pitch.reduce((s, hz) => s + semitones(hz, pitchMedian) ** 2, 0) / pitch.length);

  const listening = deriveListening({ noiseDb, speechDb, pauses, onsets, speechMs });
  const snrDb = speechDb === null ? null : round1(speechDb - noiseDb);

  const notes: VoiceNote[] = [];
  if (snrDb !== null && snrDb < 12) notes.push('noisy-room');
  if (speechDb !== null && speechDb < -42) notes.push('quiet-input');
  if (clippedPct > 0.5) notes.push('clipping');
  if (pauses.length < 3) notes.push('few-pauses');
  if (usable.length < 3) notes.push('few-takes');

  const r1 = (v: number | null) => (v === null ? null : round1(v));
  const r0 = (v: number | null) => (v === null ? null : Math.round(v));

  const profile: VoiceProfile = {
    version: VOICE_PROFILE_VERSION,
    calibratedAt: (input.now ?? new Date()).toISOString(),
    language: input.language,
    microphone: (input.microphone ?? '').slice(0, 80),
    takes: usable.length,
    room: { noiseDb: round1(noiseDb) },
    level: {
      speechDb: r1(speechDb),
      rangeDb: r1(median(usable.map((a) => a.speechRangeDb).filter((v): v is number => v !== null))),
      snrDb,
      clippedPct: round2(clippedPct),
    },
    pauses: { count: pauses.length, medianMs: r0(median(pauses)), p90Ms: r0(percentile(pauses, 90)), maxMs: pauses.length ? Math.max(...pauses) : null },
    onset: { medianMs: r0(median(onsets)), maxMs: onsets.length ? Math.max(...onsets) : null },
    pace: {
      syllablesPerSec: r1(median(usable.map((a) => a.syllablesPerSec).filter((v): v is number => v !== null))),
      wordsPerMin: r0(median(wpm)),
    },
    pitch: {
      medianHz: r0(pitchMedian), p10Hz: r0(p10), p90Hz: r0(p90),
      rangeSt: p10 !== null && p90 !== null && p10 > 0 ? round1(semitones(p90, p10)) : null,
      variabilitySt: r1(variability),
      finalContourSt: r1(median(usable.map((a) => a.finalContourSt).filter((v): v is number => v !== null))),
    },
    listening,
    notes,
  };
  return { profile, analyses };
}

/** Plain sentences for the person, not numbers for an engineer. */
export function describeProfile(p: VoiceProfile): string[] {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const lines: string[] = [];
  if (p.pauses.maxMs !== null && p.pauses.count > 0) {
    lines.push(`Your longest pause in a sentence was ${s(p.pauses.maxMs)}. Headway will wait ${s(p.listening.endOfSpeechMs)} of quiet before it decides you have finished.`);
  } else {
    lines.push(`Headway will wait ${s(p.listening.endOfSpeechMs)} of quiet before it decides you have finished.`);
  }
  if (p.onset.maxMs !== null) {
    lines.push(`You started speaking up to ${s(p.onset.maxMs)} after the microphone opened, so it will listen for ${s(p.listening.noSpeechTimeoutMs)} before giving up.`);
  }
  if (p.pace.wordsPerMin !== null) lines.push(`Your pace was about ${p.pace.wordsPerMin} words a minute. There is no right speed.`);
  if (p.pitch.medianHz !== null && p.pitch.rangeSt !== null) {
    lines.push(`Your voice sits around ${p.pitch.medianHz} Hz and moves across ${p.pitch.rangeSt} semitones as you speak.`);
  }
  for (const note of p.notes) lines.push(NOTE_TEXT[note]);
  return lines;
}

export const NOTE_TEXT: Record<VoiceNote, string> = {
  'noisy-room': 'The room was loud next to your voice. A quieter room or a closer microphone will help.',
  'quiet-input': 'Your voice reached the microphone quietly. Moving closer, or turning the microphone up, will help.',
  'clipping': 'Some of your voice was too loud for the microphone and was cut off. Moving back a little will help.',
  'few-pauses': 'There were few pauses to learn from. Reading a longer sentence will make the waiting time fit you better.',
  'few-takes': 'This was built from fewer than three sentences. More takes give a steadier profile.',
};
