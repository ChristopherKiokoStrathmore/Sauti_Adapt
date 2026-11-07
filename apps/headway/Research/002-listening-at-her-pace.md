# 002 · Listening at the person's pace

| | |
|---|---|
| **Status** | Voice calibration built (2026-11-07, branch `feature/headway-voice`). Tested with synthetic speech and a scripted fake microphone. **Not yet tested with a person** |
| **Opened** | 2026-11-07 |
| **Area** | Voice (`src/voice/`, `src/calibrate/`, side panel "Your voice") |
| **Who it affects** | Anyone whose speech has long pauses, a slow start, or an unusual level or pitch, including many people with cerebral palsy |

## The problem

Speech tools decide when someone has finished speaking by waiting for a short silence, often under a second. A person who pauses for 1.5–2 s inside a sentence gets cut off halfway through: the second half of the command is lost and the wrong thing happens, or nothing does. Fixed thresholds also assume an average room and an average voice level.

## What we built

A calibration page (`dist/calibrate.html`, opened from the side panel) that records a few seconds of room sound and then 3–6 sentences in English, Kiswahili or both. From those it measures:
- room noise
- voice level
- every pause inside a sentence
- how long she takes to start
- pace
- pitch: median, range, and the rise or fall at the end of a sentence

It then derives how long Headway should wait (`listening.endOfSpeechMs` and friends). The result is saved in her AI4A11y toolkit profile at `fields.voice`. Takes are kept locally in IndexedDB only if she ticks the box, so she never has to say them again.

## Problems found while building

1. **Digital silence broke every threshold.** A scripted fake microphone gave a perfectly silent room at -100 dB. Thresholds built on it treated hum and breath as speech, and the voice-over-room figure read 72 dB. A gated USB microphone can do the same. **Fix:** the room is never taken as quieter than -70 dB (`MIN_FLOOR_DB`), with a test. After the fix the same run measured a sensible 46 dB.
2. **A take can hold more than one sentence.** If she keeps talking, or the take runs on, the gap between sentences counts as a "pause". Takes stop automatically after 6 s of quiet, and the derived wait is capped at 6 s. Still to watch in real use.

## How we'll know it works

With Faridah, compare against fixed waits of 0.8 s and 1.5 s:
- the share of commands cut off before she finished
- the share of commands that wait too long after she has finished

Use her own saved voice-test recordings first, so she doesn't have to repeat anything. Then compare in live use.

## Solutions tried

| What | Commit | Test | Result |
|---|---|---|---|
| Calibration + voice profile in the toolkit | uncommitted (feature/headway-voice) | `test/voice.test.ts` (11 tests); browser run with a fake microphone | Scripted pauses of 1.5 s and 0.9 s measured as 1.5 s; profile saved to `chrome.storage.sync`; no console errors |

## What worked

Nothing marked yet: needs a session with a person.
