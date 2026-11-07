# Proposal: a voice profile in the AI4A11y toolkit

Status: built and tested in Headway (`apps/headway/src/voice/`). Not yet proposed upstream.

## What it adds

A person's **voice profile**: measurements of how they speak, taken once in a short
calibration and stored in their toolkit profile at `fields.voice`. Any toolkit host
that listens to speech (a browser extension, the Controller's voice mode, a phone
app) can read it and stop cutting the person off.

| Measured | Why a host needs it |
|---|---|
| Room noise floor | Tell her voice from the room |
| Speech level, range, clipping | Microphone placement advice; detection threshold |
| Pauses inside a sentence (count, median, p90, longest) | How long to wait before deciding she has finished |
| Onset (mic open → first word) | How long to wait before giving up |
| Pace (syllables/s, words/min) | Timeouts and the longest utterance to allow |
| Pitch (median, p10–p90 range in semitones, variability, end-of-sentence rise/fall) | Intonation, for later work on questions vs commands and speaker checks |

From those it derives **listening settings**: `endOfSpeechMs`, `noSpeechTimeoutMs`,
`maxUtteranceMs`, `speechThresholdDb` and `minRms`. The rules are pure functions in
`profile.ts` (`deriveListening`) with tests, so anyone can read why a value is what it is.

It measures **how** someone speaks, never what is wrong with them. No diagnosis, no
ability inference, no audio, no transcript. The profile is about 0.9 KB, so it fits
the toolkit's `chrome.storage.sync` profile record and follows the person to their
other devices.

## What would move upstream

| Headway file | Toolkit home | Notes |
|---|---|---|
| `src/voice/analysis.ts` | `toolkit/core/voice.js` | Pure, no dependencies; port TS → JS + JSDoc |
| `src/voice/profile.ts` | `toolkit/core/voice-profile.js` | `buildVoiceProfile`, `deriveListening`, `describeProfile` |
| `src/voice/store.ts` | Librarian methods `getVoiceProfile` / `setVoiceProfile` / `clearVoiceProfile` | Today it calls `setProfileFields({'fields.voice': …})` |
| `test/voice.test.ts` | `toolkit/test/voice.test.mjs` | Synthetic speech with known pauses and pitch |

Questions for the toolkit maintainers:

1. Should `voice` be a named field in the profile schema (and in `toAbilityModel`), so
   grants can share it as its own scope?
2. Should the Controller's voice mode (`controller/web/ui.js`) read
   `listening.endOfSpeechMs` instead of relying on Web Speech's own end-of-speech?
3. A `Sensors` port reading (`voice.level`) for hosts that want live input level.

## Evidence so far

- 30 Headway tests pass, including a round trip through the real pinned toolkit
  (`createToolkit` + `memoryKV`): saved, read back identical, cleared.
- Browser test: the extension loaded into Chrome for Testing with a scripted fake
  microphone. Calibration recorded a room and three sentences. The scripted 1.5 s and
  0.9 s pauses were measured as 2 pauses, the longest 1.5 s. The profile landed in
  `chrome.storage.sync` under `aa.mine.profile` → `fields.voice`. The side panel read
  it back. No console errors.
- **Not yet tested with a person.** Nothing here claims the derived settings suit
  Faridah until she has calibrated and used them.
