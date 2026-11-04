# Optional research, not a released model

Nothing in this document is promoted to the speech API, the PWA, or the extension. The running application path remains a frozen `facebook/wav2vec2-base` encoder plus per-command, per-language prototypes.

The independent [local model lab](../ml/lab/README.md) now implements an experimental comparison with the CDLI Kenyan English and Kiswahili Whisper checkpoints. It offers a model selector, the same recording across models, transcription and command metrics, and a local enrollment flow for the existing prototype. It never executes Controller actions. Real model downloads and participant performance remain unverified; the lab tests cover software behavior using artificial fixtures.

## Planned experiment

If a later study has enough consented, held-out speech, compare two optional systems against the prototype baseline on the same untouched sessions:

1. Keep the audio encoder frozen and train only a small classifier head on enrollment embeddings. The head is discarded if it increases false activations or fails a command in a language the person enrolled.
2. A Whisper-style general recognizer used only as a comparison system, not as the controller's input, unless a separate evaluation shows it rejects unknown speech at least as safely as the prototype model.

Selective fine-tuning of the encoder is out of scope until that frozen-head comparison exists. Any promoted change must beat the prototype model on untouched test clips without raising false activations. Small samples still cannot support an accuracy claim.

## Data that is not available

These datasets are research pointers only. They are gated and are not downloaded, mirrored, or used:

- https://huggingface.co/datasets/cdli/kenyan_english_nonstandard_speech_v1.0
- https://huggingface.co/datasets/cdli/kenyan_swahili_nonstandard_speech_v1.0

Do not fetch them until the access grant and the permitted uses are verified in writing. Participant recordings stay outside git. Real co-designer results remain **NOT VERIFIED**.

