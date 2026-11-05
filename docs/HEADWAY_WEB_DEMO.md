# Headway website demo for Sauti Adapt

## Scope and ownership

The Headway website demo is an optional camera powered accessibility input available from the Sauti homepage, throughout all five voice onboarding steps, and inside the three page experiences at `/workspace`.

**The Chrome extension is independently maintained.** No code under `apps/headway/**` is changed by this integration. The extension is not installed or silently injected when the Headway button is pressed.

The global `HeadwayProvider` is mounted from `apps/web/app/layout.tsx`. It persists within the Sauti application during normal Next.js client navigation and owns the single media session. The Sauti voice model, toolkit Controller, existing audio consent, and server endpoints remain unchanged.

## Shared integration contracts

The website adapter directly imports these reusable implementation modules:

* `apps/headway/src/gaze/mouth-gesture.ts`: `MouthGesture` and its calibration threshold logic.
* `apps/headway/src/gaze/motion.ts`: `adaptiveAlpha` and `MOTION_PRESETS`.

The website also uses the existing Headway workspace dependency `@vladmandic/human`. The `apps/web/scripts/prepare-headway-demo.mjs` script copies the ESM library and only required local face model assets into the public demo assets before `next dev` or `next build`. The public assets are served from the same website origin and only loaded after explicit camera activation.

**Compatibility boundary:** Changes to the imported pure modules will be picked up by the next application build. Changes elsewhere in the Chrome specific extension, especially `apps/headway/src/gaze/core.ts`, **do not automatically execute in the web adapter**. Such changes require conscious adaptation before claiming behavioral equivalence. The global quality workflow runs web typechecks, web builds and browser tests on pushes and pull requests. It also builds and tests Headway separately.

There is no automatic injection of extension code into unrelated browser tabs.

## Activation journey

1. Open the Sauti homepage.
2. Select **Enable Headway** in the global header, or in the optional setup prompt before voice onboarding.
3. Accept or deny the browser camera permission. No video starts before this action.
4. The web adapter loads local face tracking assets and detects one face.
5. Look forward for neutral position, then use **Recenter** as needed.
6. Choose **Dwell** (hold over an action for about 1.4 seconds) or **Mouth gesture**, which requires a closed and open mouth calibration.
7. Move through normal Sauti onboarding. For privacy, voice recording and destructive actions are excluded from automatic pointer activation. Use ordinary input to make sensitive consent and recording decisions.
8. On Step 5, select **Launch My Accessible Workspace**.
9. Choose reading, shopping practice, or form practice. The same Headway provider stays mounted through client navigation.
10. Select **Pause** or **Stop Headway**; Stop releases the camera tracks.

The virtual pointer can interact with approved in page controls only. Form text entry still requires an available text input method. Real payments, unrelated Chrome tabs, and other applications remain outside the web demo scope.

## Security and privacy

* Browser camera access requires an explicit button action and browser permission.
* Video frames are processed in the browser; this feature does not intentionally upload or persist video frames or facial measurements.
* Tracking pauses on lost or multiple faces and when the tab becomes hidden.
* The participant can press Escape to pause, click Stop to release the camera, or use ordinary keyboard controls.
* Automatic target activation excludes deletion, mic recording, payments, consent and external navigation.
* The Chrome Web Store installation path remains at `/install` as separate future distribution, not part of required onboarding.

## Validation

Run in a development environment with the repository's root dependencies:

```sh
python scripts/bootstrap_toolkit.py
npm ci
npm run typecheck:web
npm run build:web
npm run check:headway
npx playwright test e2e/headway-install.spec.ts e2e/headway-web-demo.spec.ts
```

The synthetic camera tests validate integration and head position mapping without a real participant. They do not establish actual tracking accuracy, accessibility suitability, participant comfort, or performance on real hardware.

### Manual real webcam acceptance

1. Open the deployed website in desktop Chrome over HTTPS.
2. Verify the webcam indicator stays off before enabling Headway.
3. Activate Headway and approve permission.
4. Confirm one face is detected, the pointer moves with actual head movement, and the sensitivity setting changes movement.
5. Test neutral recentering and both clicking methods without accidental repeated clicks.
6. Switch between the homepage and workspace and verify tracking persists without another camera prompt when using client navigation.
7. Test all three workspace experiences and confirm no real purchase or backend form submission occurs.
8. Pause, resume and stop, checking that the browser releases camera access.
9. Repeat denial, face lost, two faces and browser tab hidden.
10. Validate usability with the intended participant and their preferred movement range, including a usable keyboard fallback.

Do not represent these manual steps as complete until actually carried out.

## Commercialization path

The real Chrome extension under `apps/headway` can be tested independently through Chrome Developer Mode now. Once published through the Chrome Web Store, its installed permissions can allow interaction with supported external sites. This website simulation alone does not provide those browser permissions.
