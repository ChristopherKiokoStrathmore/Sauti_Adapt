# Sauti Adapt architecture and trust boundaries

## Our intent
The co-designer chooses a handful of useful voice commands in Kenyan English and Kiswahili. We enroll speech samples only with consent. Pretrained speech embeddings support a personalized recognition model that either recognizes a command or explicitly rejects it. Only recognized, allowlisted commands are passed to the OFFICIAL AI4A11y Controller, which dispatches actions through the matching receiving application's ControlPort.

## Architecture

```mermaid
flowchart TB
    User[Person speaks preferred command] --> Capture[Consented short WAV recording]
    Capture --> W[PWA / Chrome sidepanel]
    W --> Proxy[Next.js /api/recognize\nDemo access gate + server-side token]
    Proxy --> API[FastAPI /v1/recognize\nPrivate speech model]
    API -->|Accepted canonical intent| G[Allowlist + reject unknown]
    API -->|Rejected| NoAction[No action + accessible feedback]
    G --> C[Official AI4A11y createController.handle]
    C --> P[ControlPort receiver]
    P --> DOM[Permitted website DOM]
    Enroll[PWA enrollment /api/enroll] --> Private[Private consented recordings]
    Private --> Training[Offline model training + calibration and untouched test]
    Training --> Artifact[Private validated model artifact]
    Artifact --> API
```

## What runs where?

* The Next.js PWA is on Vercel when deployed. The Controller runs **in the browser** and drives only DOM content within that PWA.
* The Chrome sidepanel captures voice. It forwards audio over HTTPS to the Next.js API proxy. After receiving an accepted label, its **content script** runs the official Controller inside the permitted page's isolated extension environment. A user must grant host permission before injection.
* The FastAPI service runs separately. `SPEECH_MODE=mock` is safe and rejects all audio. `SPEECH_MODE=prototype` loads a private model trained with separate calibration and final test sessions and known unknown speech samples.
* Android is NOT implemented by this starter. Building Android control needs a native accessibility service and a ControlPort adapter.

## Mapping to the official toolkit

Upstream: https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit
Pinned revision: `7cf5006dbab9e328fadf54b654147c6bca44113d`

* `controller/createController.js`: `createController({control,operator})`, `.handle(utterance)`.
* `controller/grammar.js`: deterministic known phrases including `scroll down`, `scroll up`, `go back`, `read this`, `undo`.
* `controller/router.js`: resolves and dispatches the utterance.
* `controller/web/dom-receiver.js`: `createDomReceiver(root, {scrollTarget})` with real DOM action implementation.
* `controller/control-port.js`: platform-neutral receiver contract.
* `controller/mount/index.js`: optional toolkit UI, not required because Sauti Adapt uses its own microphone capture to replace default `SpeechRecognition`.
* `docs/voice-mode.md`, `controller/PROTOCOL.md`: details of existing default speech input and remote receivers.

The toolkit's stock `controller/web/ui.js` creates browser `SpeechRecognition` configured to `en-US`. Sauti Adapt deliberately does **not** use that recognizer for personalized voice input. It still uses the genuine toolkit Controller/grammar/router/DOM receiver for actions.

## Machine learning protocol

1. Co-designer chooses commands and understands what is being recorded.
2. Enroll separate short sessions. Save identifiable voice only in a private, access-controlled directory.
3. Pretrained `facebook/wav2vec2-base` extracts embeddings. This is a general model and not a validated Kenyan atypical-speech solution.
4. Compute normalized class prototypes by *intent and language* using ONLY enrollment sessions.
5. Reserve an entire held-out session, and include deliberate unknown speech recordings. Calibrate similarity and margin to avoid observed false activations. If no safe threshold permits recognition of each command, do not release the model.
6. Test on new recordings and with the co-designer. Estimate error counts and latency. Small samples cannot establish very low false-activation risk.

`confidence` is a bounded cosine similarity score, **not** a calibrated probability of correctness. Do not interpret it as statistical confidence.

## Security and privacy

* User chooses whether to capture voice. No background monitoring.
* Enrollment requires a consent flag, and cannot run until explicitly enabled on the API.
* Model and recordings live outside Git and public folders.
* Next.js protects demo endpoints using a shared team access code, then forwards a separate private backend token. This is suitable only for a controlled hackathon demo, NOT for public production.
* Release requires proper per-person authentication/authorization, deletion and retention controls, encrypted storage, rate limiting, privacy notices and abuse protection.
* A browser extension needs per-site permission and can be disabled by the user. The user must understand sensitive sites should not be enabled casually.
* Do not claim Android or iOS system-wide control is provided by a browser PWA.
* No audio/transcripts or identifiable co-designer details go into test fixtures, the repo or model cards without appropriately scoped consent.

## Design limitations we must communicate

* The actual toolkit is fetched by bootstrap; it is NOT bundled in this ZIP.
* Installing npm dependencies and downloading Wav2Vec2 weights require network access.
* No model is trained or verified against a real co-designer here.
* A PWA installed on Android controls its own content, not other apps.
* The Chrome extension is not cross-browser tested and works only on permitted HTTP(S) sites. Browser-internal pages and some restricted contexts cannot be controlled.
* The model API's local filesystem may be ephemeral on some hosting providers; use private durable object storage before public release.
* On-device private inference and multi-device profile sync are later milestones.
