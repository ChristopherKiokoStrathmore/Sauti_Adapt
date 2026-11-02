# Official toolkit dependency

Do not copy or reimplement the Controller. Run `python scripts/bootstrap_toolkit.py` (or `npm run setup:toolkit`) from the repository root before typecheck or build.

The checkout is **gitignored** (`vendor/ai4a11y-toolkit/` in `.gitignore`) and fetched by that script. This repository does not vendor a second copy of the toolkit. CI runs the bootstrap before JavaScript builds. A wrong SHA, a dirty worktree, or a checkout missing the Controller files exits non-zero.

## Provenance

| | |
| --- | --- |
| Upstream | https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit |
| Pinned commit | `7cf5006dbab9e328fadf54b654147c6bca44113d` |
| License | Apache License 2.0. Full text: `LICENSE` in that commit (and in the gitignored checkout after bootstrap). |
| What this repo is | An independent hackathon integration. Not an official toolkit release. |

Direct imports (the real modules, not a local class):

- `apps/web/components/SautiDashboard.tsx` and `apps/extension/src/content.ts` import `createController` from `controller/createController.js` and `createDomReceiver` from `controller/web/dom-receiver.js`.

Those imports pull in, at bundle time:

- `controller/control-port.js`
- `controller/router.js`
- `controller/grammar.js`
- `controller/intent.js`
- `controller/presentation.js`
- `toolkit/registry/tools.js` (`settingsMeta` for the deterministic grammar)

Read for integration and not imported by the apps:

- `controller/mount/index.js` (`mountController` only places the stock widget)
- `controller/web/ui.js` (stock text/voice widget and `CONTROLLER_CSS`)
- `controller/DESIGN.md`
- `controller/PROTOCOL.md`

Sauti Adapt does not import `controller/web/ui.js` or `controller/mount/index.js`. That module feature-detects browser `SpeechRecognition` and speaks with `speechSynthesis`. Personalized capture stays in `@sauti/shared` and the speech API. The DOM receiver still applies settings by setting CSS variables and classes (`--aa-font-scale`, `.aa-dark`, and the others in `createDomReceiver`). The rules that make those visible are `CONTROLLER_CSS` in `controller/web/ui.js`, injected only when the stock UI is mounted. Host pages do not get that stylesheet from `createDomReceiver` alone.

## Upstream notes at this pin

- `controller/DESIGN.md` shows `createController({ mount, operator: { uid } })`. The function accepts `{ control, llm, operator, rawToTask }`. Mounting is a separate `mountController()` call. `operator` is `{ abilityModel, librarian }`, and the code reads `operator.abilityModel`.
- The default `operator = null` makes TypeScript infer `null` and ignore the JSDoc object type. `packages/shared/src/toolkit-modules.d.ts` declares the documented operator object so call sites pass it without a cast. The value passed is still the real options object.
- `handle()` includes `pending` only on the confirmation return. Other returns do not have that property.
- `supportAreas: ['motor']` sets `confirmActions`. Confirmation applies to `activate`, `submit`, and `navigate`, not to scroll, back, read, undo, or font changes.
- `mount/index.js` companion mode moves the target into a wrapper. `unmount()` does not put the target back.
- `controller/web/dom-receiver.js` does not declare `navigate` or `search`. The router will not perform those actions on this receiver unless the receiver lists them. Scroll, back, forward, and activate are declared.
