# Sauti Adapt supervised demonstration story

Status: **SCRIPT ONLY**. Do not present this as a previously completed test.

## The story

A person chooses how they want to interact with their laptop. Sauti lets
them decide whether to use voice input, the accessible workspace controls,
or a separate head pointer interface.

1. **Onboarding**: open the Sauti home page, choose language and
   accessibility settings, and inspect the permission disclosure.
   Use a disposable demonstration profile, never somebody's real
   credentials or recordings without separate authorisation.
2. **Voice attempt**: demonstrate the microphone permission prompt, start
   and stop capture, and inspect the server's accepted or rejected response.
   In mock mode, the audio MUST be rejected and MUST NOT execute a command.
3. **Controller action**: use an explicit Sauti test button to invoke the
   official pinned AI4A11y Controller on the authorised workspace.
   State clearly that this button action is not a successful voice prediction.
4. **Unknown speech**: attempt an unrelated phrase in an approved test
   environment. A correctly fail-closed service rejects it. This is not
   statistical proof of safety.
5. **Deletion**: use a disposable test profile, delete its saved recording
   and confirm the API response and private storage cleanup.
6. **Boundary**: describe browser extension permissions separately. A web
   page does not control arbitrary laptop applications.

## Evidence to capture before a live claim

* Runtime commit and deployment identifiers
* API readiness and model revision
* Calibration release record with suitable negative sample counts
* Real utterance transcripts and command decisions in private research data
* Observed Controller action in the permitted page and a safe rejection
* Verified deletion and revocation, including server-side account status

Every step without recorded evidence remains **NOT VERIFIED**.
