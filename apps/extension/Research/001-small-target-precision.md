# 001 · Hitting small targets with the head pointer

| | |
|---|---|
| **Status** | A–E implemented (2026-11-04). A–D committed after Brian reported they felt better in use; E built after he saw YouTube reject the click. No measured results yet |
| **Opened** | 2026-11-04 |
| **Area** | Head pointer (`src/gaze/`) |
| **Who it affects** | Anyone using the head pointer, most of all people whose head movement is less steady or has a smaller range, including many people with cerebral palsy |

## The problem

Large targets work with the head pointer: video thumbnails, big buttons, long links. Small targets mostly don't.

The first case we recorded was the YouTube ad **Skip** button, which is about 110 × 45 px. The pointer either stops short of it or goes past it. Mouth click almost never lands on it. In practice, someone using Headway alone can't skip an ad.

This matters well beyond YouTube. Small controls are everywhere on the web: close buttons, checkboxes, menu icons, cookie banners, video controls. If a person can't hit them, they get stuck on pages they should be able to use alone.

## Why it happens (what we found in the code)

These are listed most likely first. None of them has been measured with a person yet.

1. **Snapping only works on links.** The magnetic snap that pulls the pointer onto targets within 42 px only searches `a, [role="link"]` (`src/gaze/dwell.ts`, `nearestLink`). Skip is a `<button>`, so nothing helps the pointer onto it. Mouth click then falls back to `document.elementFromPoint` at the exact pointer pixel.

2. **The pointer is not held still while clicking.** Mouth click fires when the mouth crosses 70 % of the calibrated open range (`src/gaze/core.ts`, `MOUTH_OPEN_COOLDOWN_MS` block). Opening the jaw tends to move the head, and the pointer keeps following it. The click lands where the pointer drifted to, not where the person was aiming.

3. **Smoothing adds lag, and lag causes overshoot.** Near the centre of the screen the pointer moves only 6 % of the remaining distance per frame (`HEAD_CENTER_LERP = 0.06`). Layered on top are a One-Euro filter (`min cutoff 0.4`) and a 12 px deadzone (`DEADZONE_PX`). The pointer feels steady but trails the head. The person keeps turning, the pointer catches up late, and it passes the target.

4. **Head angle maps directly to screen position.** Each head pose corresponds to one fixed screen point, and the calibrated head range is stretched across the whole viewport. A small tremor therefore becomes several pixels on screen. Speed doesn't change, so there is no way to go slower while aiming.

5. **Holding the mouth open kept clicking.** Found while implementing B. The old check was "ratio above threshold and 800 ms since the last click", so a mouth held open clicked again every 0.8 s. That is dangerous for anyone whose mouth rests open.

6. **Clicks are synthetic.** `synthClick` sends JavaScript mouse events with `isTrusted: false`. **Confirmed 2026-11-04:** once the pointer could reach Skip (after A–D), YouTube still ignored the click. Brian saw this on a live ad.

## What others do

| System | Relevant approach |
|---|---|
| Google Project Gameface | Separate speed per direction (up, down, left, right); adjustable smoothing; acceleration (faster when the head moves fast); tracks the forehead because eye landmarks shift on blinks |
| Apple Head Pointer (macOS) | Choice of movement mode (follow head direction, or move while facing a screen edge); pointer speed; recentre by switch or facial expression |
| Enable Viacam | Acceleration, separate vertical speed, smoothing, dwell area in pixels |
| Windows Eye Control | "Precise mouse": aim roughly, then fine-tune the position before clicking. Microsoft recommends it for missed small buttons |

Mozilla does not have a head-pointer feature. Our only Mozilla dependency is Readability, used for summaries.

## What the research says

- **Bubble cursor** (Grossman & Balakrishnan, CHI 2005). The pointer always selects the nearest target, so a small target in an empty area behaves as if it were large. It is the strongest general technique for small targets, but weaker in dense layouts.
- **Zoom, then select.** Magnifying before selecting helps most with small targets. One study reported a 36 % efficiency gain for an eye mouse with zoom.
- **Hybrid control** (Paul et al., IBM). Blending position control with rate (speed) control suits head pointing better than either alone.
- **Locking the cursor during selection.** Head-gesture selection studies treat cursor locks as part of the selection design. This supports freezing the pointer during the mouth click.
- **Expressive gestures can disturb aiming.** Facial gestures used for clicking can interfere with precise cursor control (preprint review).

## Candidate solutions, not yet tried

| # | Idea | Expected effect | Size |
|---|---|---|---|
| A | Snap to anything clickable (buttons, `role="button"`, inputs, `[tabindex]`, video controls), not only links | Fixes Skip and most small buttons | Small |
| B | Freeze the target when the mouth starts to open, and click that target | Removes click-time drift | Small |
| C | Precision zoom: a gesture or dwell opens a 2–3× view around the pointer for the final pick | Reliable fallback for tiny or crowded targets | Medium |
| D | Speed that depends on head velocity, plus speed per direction, both adjustable in the side panel | Less lag and less overshoot; fits each person's range | Medium |
| E | Trusted clicks via `chrome.debugger` `Input.dispatchMouseEvent`, only if 6 proves to be a real cause | Clicks work on sites that ignore synthetic events | Medium; shows a debugging banner |

## How we will know it works

Before calling anything solved, test with the people who will use it, not only with ourselves:

- A fixed test page with targets of 24, 32, 44, 64 and 110 px, placed in open and in crowded areas.
- For each target size, record the hit rate, time to hit and wrong clicks, before and after each change.
- Repeat the same tasks on real sites: YouTube Skip, a cookie banner, a video's pause button.
- Ask the person what felt easier or harder, including fatigue over a session. Their judgement decides between options that score close together.
- Don't assume anyone's abilities from a diagnosis. Settings should adapt to how each person actually moves.

## Solutions tried

### Round 1 (2026-11-04): A + B + C + D, not yet committed

**What changed**

| | Change | Where |
|---|---|---|
| A | Snap to any clickable (buttons, roles, inputs, `.ytp-button`, `cursor: pointer` parents), measured to the target's **edge**, not its centre. Skips targets hidden behind something else. The snapped target always gets a lime frame so you can see what a click will hit. Snap reach 42 px; it stays snapped within 24 px of the edge. | `src/gaze/targets.ts`, `dwell.ts` |
| B | The mouth gesture is a small state machine. At 35 % open, the pointer and its target **freeze**. At 70 % it clicks **once**. It re-arms only after the mouth drops below 25 %. The freeze ends after 1.2 s regardless, so a mouth that rests open can't lock the pointer. | `src/gaze/mouth-gesture.ts`, `core.ts`, `dwell.ts` |
| C | **Precision picker** instead of a magnifier. A content script can't render a live, clickable zoomed copy of the page. When a click lands where 2 or more targets sit within 40 px and neither is 12 px clearer, Headway numbers them on the page and shows the same numbers as large tiles (72 px tall), placed clear of the targets. Pick a tile with the pointer and a mouth click. Cancel, Esc and a 15 s timeout all close it. | `src/gaze/picker.ts`, `dwell.ts` |
| D | The follow rate grows with the distance still to cover: 10 % for small corrections up to 45 % for big moves on Balanced. The old rate was a fixed 6–12 %. New side-panel controls: **Pointer speed** (0.6–1.6×) and **Steadiness** (Responsive / Balanced / Steady), which also retunes the One-Euro filter. Per-direction reach still comes from head calibration, which measures left, right, up and down separately. | `src/gaze/motion.ts`, `core.ts`, side panel |

E was deferred in round 1, then confirmed necessary; see round 2.

**How it was checked (no person yet)**

- Unit tests (`test/pointing.test.ts`, 7 tests): edge distance, ambiguity, follow rate, setting clamps, mouth gesture (one click per opening, re-arm on close, 1.2 s freeze limit).
- Browser harness with a YouTube-style 110 × 44 px Skip button and three adjacent 28 px buttons:
  - Skip is found from 20 px away. Before, nothing was snapped.
  - Skip alone is not treated as ambiguous.
  - The three buttons are ambiguous, the picker shows "Like / Dislike / Share", and picking tile 2 clicks Dislike.
- The harness exposed a bug before it shipped: the target cache treated `0` as "fresh", so for the first 600 ms on a page nothing was found. Fixed.
- Head-tracking pipeline still starts in Chromium with a fake camera (ready in 6 s, no errors).

**Next: measure with a person**

1. Serve the test page: `python3 -m http.server 8765 --directory apps/extension/Research`, then open <http://localhost:8765/target-test.html>. Content scripts don't run on `file://` pages.
2. Run 25 targets in **Open** and in **Crowded** layout, on the build before this round (`git stash`) and after it.
3. Paste each JSON block below, with what the person said and how tired they were.

_Results: none yet._

### Round 2 (2026-11-04): E, real clicks, not yet committed

**Why:** after round 1 the pointer reached Skip, but YouTube ignored the click because it was synthetic.

**What changed**

- `src/background/trusted-click.ts` sends `Input.dispatchMouseEvent` (move, press, release) through `chrome.debugger`. Chrome treats that as real mouse input.
- The content script picks a point inside the target where the browser's own hit test lands on that target, preferring the pointer's position. It asks the worker to click there, and falls back to a synthetic click if that fails.
- Headway's own UI (the picker and tooltips) still uses synthetic clicks.
- The camera preview is now `pointer-events: none`, so a real click under it reaches the page.
- New permission: `debugger`.
- New side-panel switch **Real clicks**, on by default.

**Trade-off:** while attached, Chrome shows "Headway started debugging this browser". Headway attaches to a tab only on the first click there, stays attached while tracking is on (so the bar does not flash on every click), and detaches when tracking or Real clicks is turned off. Pressing Cancel on Chrome's bar ends the session, and clicks fall back to synthetic ones.

**How it was checked:** in Chromium with the built extension, a page logged `isTrusted` for each click on a 110 × 44 px button. The synthetic click arrived as `false`; Headway's click from the worker arrived as `true`.

**Not yet checked:** skipping a live YouTube ad with the head pointer. Ads appear unpredictably, so this needs a real session.

## What worked

_To be filled in once something has been tested and kept._

## Sources

- Project GameFace: <https://developers.googleblog.com/en/project-gameface-makes-gaming-accessible-to-everyone/>, config: <https://github.com/Ajay9o9/project-gameface>, hands-on: <https://digitaltrends.com/?p=3355681>
- Apple Head Pointer: <https://support.apple.com/guide/mac-help/mchlb2d4782b>, <https://mcmw.abilitynet.org.uk/how-to-use-the-head-pointer-in-macos>
- Enable Viacam options: <https://svnlliurexnet.gva.es/focal/eviacam/trunk/fuentes/doc/help/en/options.htm>
- Windows Eye Control: <https://support.microsoft.com/windows/eye-control-basics-in-windows-97d68837-b993-8462-1f9d-3c957117b1cf>
- Bubble cursor: <https://www.dgp.toronto.edu/papers/tgrossman_CHI2005.pdf>
- Zoom for eye pointing: <https://a11y-paradise.onrender.com/reviews/69dd315c69eb7ae455b04137>; small-target gaze selection: <https://research.wright.edu/en/publications/small-target-selection-with-gaze-alone/>
- Paul et al., head gestures: <https://researcher.watson.ibm.com/publications/head-gestures-for-computer-control>
- Gizatdinova et al., AVI 2012: <https://homepages.tuni.fi/oleg.spakov/publications/Gizatdinova_AVI_12.pdf>
- Facial-gesture input review (preprint): <https://www.preprints.org/frontend/manuscript/656d147b138c0fa5a4583ed05c0660e2/download_pub>
