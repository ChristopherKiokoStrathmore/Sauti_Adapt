# Headway Voice: plan

Status: proposal, 2026-11-07. Nothing below is built yet unless it says so.
Design board: [`../design/voice-onboarding.html`](../design/voice-onboarding.html) (open it in a browser).

## What we are building

An audio-only Headway. Faridah starts listening with a trigger she chose, speaks
in Kenyan English or Kiswahili, and her browser does what she said. Head
tracking is left out of this version.

```
her trigger ─▶ record 16 kHz ─▶ Sauti model (Modal GPU) ─▶ transcript
                                                              │
          Controller.handle(transcript)  ◀────────────────────┘
            1. toolkit grammar + her aliases   (instant, no network)
            2. Gemini via the toolkit LLM lane (only on a miss)
            3. nothing confident  ─▶ "Did you mean…", nothing runs
                       │
                       ▼
          ChromeControlPort.performAction / applySettings / getContent
                       │
                       ▼
          the page, then feedback the way she chose (speech, sound, text)
```

This is the whiteboard (voice → model → transcript → Gemini → tools → actions on
the browser) mapped onto the AI4A11y toolkit's Controller, so that the toolkit is
part of how Headway works rather than a library next to it.

## The flow in screenshots

All values in these screens (transcripts, scores, times) are samples, not results.

### In Chrome: the story on real pages

Real YouTube pages (captured signed out, with ads removed and comments blurred),
with the Headway side panel design laid over them. The same storyboard is in Figma
as an import of [`../design/Headway-Voice-Figma-import.pdf`](../design/Headway-Voice-Figma-import.pdf).

**01 · Set up once, in her own voice.** Three readings of one take.
![Scene 1](../design/screens/chrome/scene-1.jpg)

**02 · She presses her key, from the page.** The tab is muted; Headway waits at her pace.
![Scene 2](../design/screens/chrome/scene-2.jpg)

**03 · Fast path: the command list.** Her phrase "simamisha" pauses the video. No Gemini call.
![Scene 3](../design/screens/chrome/scene-3.jpg)

**04 · Gemini lane.** "Take me to where people are commenting": Gemini sees her words and a menu, never the page.
![Scene 4](../design/screens/chrome/scene-4.jpg)

**05 · Chrome acts, Headway answers.** Scrolls to the comments, says so, and logs the time.
![Scene 5](../design/screens/chrome/scene-5.jpg)

**06 · Not sure? Nothing runs.** Numbered choices on the page match the panel.
![Scene 6](../design/screens/chrome/scene-6.jpg)

### How one command travels

![Pipeline: trigger, Sauti model, Controller, Chrome port, page](../design/screens/00-pipeline.png)

### The Gemini lane (only when the command list misses)

Gemini never sees the page, only her words and the actions this tab supports.
Its answer is checked against those actions before anything runs. If the check
fails, she gets "Did you mean…" (screen 14) and nothing happens.

![Gemini lane, seven steps](../design/screens/00-gemini-lane.png)

### Onboarding: calibrating to her voice

| | | |
|---|---|---|
| **1 · Welcome**<br>![](../design/screens/01-welcome.png) | **2 · Consent**<br>![](../design/screens/02-your-recordings.png) | **3 · Mic and room noise**<br>![](../design/screens/03-microphone-and-room.png) |
| **4 · Her trigger**<br>![](../design/screens/04-how-you-start-talking.png) | **5 · Her pace**<br>![](../design/screens/05-your-pace.png) | **6 · Her commands**<br>![](../design/screens/06-your-words.png) |
| **7 · Record: three readings**<br>![](../design/screens/07-record-a-command.png) | **8 · Listening**<br>![](../design/screens/08-listening.png) | **9 · Rest**<br>![](../design/screens/09-rest.png) |
| **10 · Feedback and checks**<br>![](../design/screens/10-answers-and-checks.png) | **11 · Before / after**<br>![](../design/screens/11-your-results.png) | |

### In use

| | | |
|---|---|---|
| **12 · Ready**<br>![](../design/screens/12-ready.png) | **13 · Asking Gemini**<br>![](../design/screens/13-working-it-out.png) | **14 · Did you mean…**<br>![](../design/screens/14-not-sure.png) |
| **15 · Check before sending**<br>![](../design/screens/15-check-before-sending.png) | | |

To regenerate the screenshots after changing the board, open
`design/voice-onboarding.html` and capture each `.slot` (Playwright, dark theme,
2× scale).

## Using the toolkit

Toolkit checkout: `~/Documents/AI-for-Accessibility-Toolkit`, fast-forwarded to
upstream `c31ce2b` on 2026-11-07. Sauti's `scripts/bootstrap_toolkit.py` pins
`7cf5006`, which is an ancestor of `c31ce2b`. **Decision needed:** keep the pin, or
move it forward for Headway only. Since the pin, the Controller changed in one
commit (dyslexia font removed). The new `blocks/shortcut.js` and
`blocks/profile-words.js` are useful to us.

| Toolkit part | How Headway uses it |
|---|---|
| `controller/createController.js` | One Controller in the side panel. Every transcript goes through `handle()`. Confirmation uses its built-in yes/no pending state. |
| `controller/grammar.js` | First pass: scroll, back, forward, open, search, click. Her aliases ("shuka chini" → scroll down) are matched before it. |
| `controller/llm-lane.js` | Gemini plugs in as `complete(prompt)`. It sees only her words and the actions this tab declares, never page text. Its JSON is filtered to the declared actions. |
| `controller/control-port.js` | `ChromeControlPort` implements the seven methods plus `stop`. |
| `controller/web/dom-receiver.js` | Runs in the content script for page-level actions and settings. The Chrome port adds tab-level actions around it. |
| `toolkit/platforms/chrome/ports.js` | `chromeKV`, `chromeClock` and `chromeScheduler` back `createToolkit`, so her profile lives in `chrome.storage`. |
| Librarian (`toolkit/core/librarian.js`) | Stores her voice profile: trigger, end-of-speech wait, noise floor, commands, aliases, feedback choice. A "Remember: when I say school I mean scroll" is a **proposal** she accepts, never a silent change. |
| `controller/presentation.js` | Used for output delivery. **Override:** it switches `confirmActions` on from a "motor" profile. Headway sets it from her own answer in onboarding step 9 instead. |
| `blocks/shortcut.js` | Her trigger key is stored with this, so it follows her profile. |

## The Chrome control port

One `ControlPort` over Chrome APIs. `describeCapabilities()` lists only what works
on the current tab, so Gemini can't pick something impossible.

| Action | Chrome API |
|---|---|
| scroll, activate (by visible label), type, read this | content script + `chrome.scripting`. Trusted click via `chrome.debugger` (already in `src/background/trusted-click.ts`). |
| back, forward, reload | `chrome.tabs.goBack` / `goForward` / `reload` |
| open site, new tab, close tab, next / previous tab | `chrome.tabs.create` / `update` / `remove` / `query` + `highlight` |
| search | `chrome.search.query` (her default engine) |
| zoom | `chrome.tabs.setZoom` |
| mute while she speaks | `chrome.tabs.update({ muted })` (the Controller's `muteAudio`) |
| pause/play video | the existing YouTube bridge, else the page's media element |
| speak results | `chrome.tts` with her chosen voice and rate |
| start listening from any page | `chrome.commands` (default Alt+Shift+H; she can change it) |

Pages Chrome protects (`chrome://`, the Web Store, other extensions) can't be
scripted. The port reports this, and Headway says so rather than failing silently.

## Making more requests work well

Each command is now up to two network calls (Modal, then sometimes Gemini).

1. **Keep the pipeline in the side panel, not the service worker.** The panel
   stays alive while it is open. An MV3 service worker sleeps after about 30 s,
   which would drop in-flight requests.
2. **Grammar and aliases first.** Common commands never call Gemini.
3. **One request in flight.** A new utterance aborts the old one
   (`AbortController`). Past 5 s, show "still working".
4. **Warm GPU during sessions.** `ml/modal/warm.py on 3` before a session. The
   panel shows "model warm / waking up" from a cheap status call.
5. **Cache capabilities per tab.** Refresh them on `chrome.tabs.onUpdated` and
   `onActivated`, not on every utterance.
6. **Gemini choice.** Prefer Chrome's on-device Gemini Nano (Prompt API with a
   JSON schema), which Headway already uses for summaries: no key, no network.
   Fall back to cloud Gemini Flash through our relay when Nano is missing or
   unsure. Measure both on her real commands before choosing.
7. **Show timings in the history.** Latency gets measured in real use, not guessed.

### Secrets

The Modal bearer token and any Gemini key must **not** ship in the extension
bundle, because anyone can unzip an extension. The extension calls a small relay
with her personal token. The relay adds the server credential. This is the same
shape as AGENTS.md rule 8 (`apps/web/lib/proxy.ts`). For the hackathon demo, the
`tools/voice-test/serve.py` forwarder pattern on localhost is acceptable. Say so
in the demo.

## Onboarding: calibrating to her

| Step | What it sets | Where it lives |
|---|---|---|
| 1 Welcome | helper mode (someone sets up with her) | profile |
| 2 Consent | two separate yeses: use, and train a personal model | profile + consent port |
| 3 Mic and room | noise floor (per room), microphone | profile |
| 4 Trigger | key / panel button / switch; finish on pause or press | `shortcut` block + profile |
| 5 Pace | end-of-speech wait from her longest mid-sentence pause | profile |
| 6 Words | her command set, language, her own phrases | profile (aliases) |
| 7 Record | 3 takes per command: 2 to learn from, 1 held out | local recordings |
| 8 Rest | breaks every 3 commands; resume anywhere | — |
| 9 Answers | speech / sound / text; when to confirm | profile → presentation |
| 10 Results | before/after on held-out takes | shown, stored locally |

Every take is saved before it is sent, as `tools/voice-test` already does, so she
never repeats one.

## Showing the difference personalisation makes

1. **Three readings of every take** (step 7): Chrome standard recognition, Sauti
   as it ships, and Sauti with her calibration. Words heard wrong are struck
   through. Chrome's reading needs her opt-in, because it sends audio to Google.
2. **The pace picture** (step 5): the same recording cut off where standard
   listening stops, next to Headway waiting through her pause.
3. **Before/after score** (step 10): understood first time on held-out takes,
   against both baselines, with the sample size on screen.
4. **Live in use**: "Did you mean…" with her transcript. Each correction she
   accepts improves her aliases. History shows how often she was understood the
   first time, week by week.
5. **Demo mode for judges:** one recording, and the action each pipeline *would*
   have taken ("Chrome: searched 'school town'. Headway: scrolled down"). Nothing
   runs.

### Personalisation levels, cheapest first

| Level | What | Needs training? | Status |
|---|---|---|---|
| 1 | Pace, noise floor, trigger, feedback | no | design only |
| 2 | Aliases from her takes and corrections (heard → meant) | no | design only |
| 3 | Vocabulary hint: pass her command phrases to Whisper as a decoder prompt | no, but a server change | not tested |
| 4 | Her LoRA adapter on the Modal `personalized_*` slot | yes | adapter exists (dev's Colab); `test.ipynb` comparison still pending; server pins peft 0.17.1 vs adapter's 0.21.2 |

Levels 1 to 3 work on day one. Level 4 only goes live after her separate consent
and a held-out comparison on her own recordings.

## Phases

1. **Pipeline spike:** side panel records → relay → Modal → transcript →
   `createController().handle()` with the grammar only → `ChromeControlPort`
   (scroll, back, tabs). Test on 2 unrelated permitted sites.
2. **Gemini lane:** Nano first, cloud fallback; rejection path ("Did you mean…").
3. **Onboarding:** steps 1–10 as designed. Profile stored through the toolkit Librarian.
4. **Showcase:** three readings, before/after, demo mode.
5. **Evaluation with Faridah:** held-out takes, unknown phrases, fatigue, latency.
   Each bottleneck goes in `apps/headway/Research/NNN-*.md`.

## Rules carried over

- Unclear speech never runs. Mock mode never runs anything.
- She chooses commands, trigger, feedback and confirmation. Nothing is inferred from a diagnosis.
- No background listening. Recordings stay local; delete-all is one button.
- Numbers come from her held-out takes only, with the sample size shown.
- The extension controls web pages only, not the browser UI or other apps.
