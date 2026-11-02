# Codex development instructions: Sauti Adapt Team 4

## Product mission
Build co-designed personalized voice accessibility for Kenyan English and Kiswahili, reusing the official AI for Accessibility Toolkit Controller. Our first fully working milestone is a Next.js PWA and Chrome extension controlling permitted pages through the *actual* Controller `handle()` and DOM receiver. Android is a later platform adapter, not something to claim is already working.

## Non-negotiables
1. DO NOT implement an imitation AI4A11y Controller. Bootstrap the real toolkit with `python scripts/bootstrap_toolkit.py` at SHA `7cf5006dbab9e328fadf54b654147c6bca44113d`.
2. Keep the ML model isolated from command execution. The only allowed canonical commands are in `packages/shared/src/index.ts`. The Controller is responsible for dispatch to a `ControlPort`.
3. Default to rejection. In `SPEECH_MODE=mock`, voice commands NEVER execute. In real mode, unknown/uncertain commands NEVER execute. Never claim accuracy without actual held-out, co-designer data.
4. Keep voice recordings, private model weights, access credentials and PII out of Git, logs, preview deployments and publicly readable paths.
5. Only record audio after deliberate user action and informed consent. No background monitoring. If the participant withdraws, stop using the audio and implement a deletion workflow before public release.
6. Do not use unlicensed or gated datasets until access and permitted uses are verified. Kenyan atypical English and Kiswahili speech model references are research pointers, NOT predownloaded dependencies.
7. Never imply the PWA can control other applications on a phone. Chrome extension works only on permitted websites. Android requires native AccessibilityService and explicit OS approval.
8. Preserve authentication: Next routes require demo code and relay to backend using server-side token. This shared code is HACKATHON ONLY, replace with real user auth before public deployment.
9. Require user participation in choosing useful commands, accessible microphone triggers, feedback and confirmation behavior. Never infer functional abilities from diagnoses.
10. Maintain a changelog and document upstream toolkit bugs. Tests must run before every merge.

## First steps for Codex
- Read README.md, docs/ARCHITECTURE.md and the official `controller/DESIGN.md`, `controller/PROTOCOL.md`, `docs/voice-mode.md` after setup.
- Run Python and shared tests.
- Run bootstrap, `npm install`, full TS/extension build and actual Playwright browser tests. If network/permissions prevent a step, log that it is NOT VERIFIED.
- Correct build/API incompatibilities without silently substituting mocks for official Controller.
- Add tests for command dispatch, unknown rejection, and co-designer workflow.
- Create focused PRs under `feature/*` branches, with screenshots and acceptance evidence.

## Implementation layers
1. `packages/shared`: canonical intents, input/output contracts, browser WAV recording.
2. `services/speech-api`: authenticated enrollment, strict WAV validation, pretrained encoder, prototype training and validation, rejection.
3. `apps/web`: Next.js enrollment PWA and official Controller connected to in-page DOM receiver.
4. `apps/extension`: Chrome MV3 sidepanel, explicit per-site permissions, bundled official Controller content script.
5. `vendor/ai4a11y-toolkit`: pinned upstream checkout, not a replacement and not committed by default.

## Quality gates
- Python API unit and negative tests.
- Shared TypeScript command allowlist tests.
- Typecheck Next.js and compile extension against real toolkit.
- Browser integration with 2 permitted unrelated websites.
- A co-designer led evaluation on separate speech recordings, unknown phrases, fatigue and latency.
- No overstated claims or fabricated metrics.
