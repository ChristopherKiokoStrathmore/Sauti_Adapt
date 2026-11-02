# Acceptance checks

Automated rows name the test that produced the evidence. CI for the commit that added these checks: https://github.com/ChristopherKiokoStrathmore/Sauti_Adapt/actions/runs/41494762071 (python, javascript, and e2e all passed on `ee70ac3`). A row is PASS only for that automated check. Anything that needs a real microphone, a real co-designer's speech, or the participant's own websites is NOT VERIFIED. Fixture audio and stubbed recognition responses are not a substitute for those.

## 1. The same command operates two different permitted websites through the real toolkit

- Automated fixture: PASS. `e2e/extension.spec.ts` → "enabled sites use the real Controller and other sites do not". Two local origins (`127.0.0.1:3000` and `localhost:3000`) receive `scroll down` from the pinned Controller after each origin is enabled. A third origin is refused. An unenabled origin does not scroll.
- Real co-designer websites: NOT VERIFIED. Needs the extension loaded in the participant's Chrome and two websites they actually use.

## 2. Kenyan English and Kiswahili are evaluated independently, and unknown speech is rejected

- Automated fixture: the release gate is enforced. `services/speech-api/tests/test_train.py` → `test_release_requires_each_enrolled_language` uses artificial tones and a fake encoder. The model is not released when Kiswahili has no correct activation, even if Kenyan English would have passed. `test_mock_mode_rejects_audio_not_fabricates_intent` checks that mock mode returns `rejected` / `UNKNOWN`.
- Real speech: NOT VERIFIED. Needs consented Kenyan English and Kiswahili recordings from the participant, including deliberate unknown speech, scored separately. Fixture tones are not that evidence.

## 3. A tab change, permission revocation, or auth loss prevents execution

- Automated Chromium: PASS for the extension gates in `e2e/binding.spec.ts`:
  - "switching tabs during inference does not scroll the new tab"
  - "navigating during inference does not run the command"
  - "revoking the origin during inference does not run the command"
  - "clearing the token during inference does not run the command"
- Automated Chromium: PASS for the PWA gates in `e2e/real-controller.spec.ts` → "a route change or cleared token during recognition runs no command".
- The recognition response in these tests is a stub. The microphone is a generated tone. The tab, navigation, permission, and credential checks are the real extension and PWA code.
- A participant session with a real microphone is NOT VERIFIED.

## 4. Usable feedback in the PWA and the extension, including read-aloud and confirmation

- Read-aloud: PASS as an automated check that `speechSynthesis.speak` receives the controller text and that rejected speech does not speak.
  - PWA: `e2e/real-controller.spec.ts` → "read this is spoken and a rejected recognition is silent" and "read this page speaks the on-screen article with speechSynthesis".
  - Extension: `e2e/binding.spec.ts` → "read this from the controller is spoken" and "rejected speech is not spoken".
- Screen-reader status text is the `role="status"` region used by those tests.
- Confirmation handling (yes/no before `activate`, `submit`, or `navigate` when the motor profile asks for it): NOT VERIFIED. Needs an observed confirmation in the PWA and the extension with the participant.
