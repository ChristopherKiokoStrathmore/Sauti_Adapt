# Sauti Adapt: private participant Whisper LoRA deployment

Status: **comparison-only integration prepared in code**. GPU deployment, actual private
adapter transfer, authenticated participant audio testing, and command release are NOT
verified by this document. The live browser recognizer is deliberately unchanged.

## Measured evidence in the co-designer research notebook

The team's private Colab notebook completed two LoRA runs on a T4. Each language
had 32 training, 8 validation and 10 held-out test recordings. These are small
single-participant exploratory metrics, not proof of reliable navigation.

| Language | Original CDLI WER | LoRA WER |
| --- | ---: | ---: |
| English | 0.2530 | 0.1928 |
| Kiswahili | 0.4426 | 0.4426 |

The command evaluation reported `NO_PARTICIPANT_COMMAND_SAMPLES`. The personalized
models therefore remain **RESEARCH_ONLY** and MUST NOT activate navigation.

## Production topology

```text
Consented participant on https://sauti-adapt.vercel.app/admin
  -> Next.js POST /api/compare (session authenticated)
  -> Railway POST /v1/compare (participant ownership verified)
  -> Modal HTTPS endpoint (service bearer required)
  -> CDLI Whisper Large V3 + participant LoRA in private Modal Volume
  -> transcription + comparison status to the browser
  -> NO AI4A11y Controller action in comparison mode
```

Existing Vercel / Railway application boundaries are preserved. Do not send
the recordings directly from the browser to a public Modal endpoint. The
original Wav2Vec2 comparison and the regular /v1/recognize route are unchanged.

## 1. Prepare privacy and GPU controls

Before transferring a real participant's voice adapter, verify that their
consent permits hosting the derived adapter outside Google Drive, review the
processing region, retention, access restrictions, data transfer and deletion
arrangements, and obtain applicable institutional approvals. Set budget alerts
and ensure only approved maintainers can access the private Modal workspace.

The user needs to create an account with Modal, connect billing, and set a
secret named `sauti-gpu-auth` containing `SAUTI_GPU_BEARER_TOKEN`. The actual
secret value must never be committed to the public repository.

## 2. Transfer the private adapters directly from authorized Colab

Never upload the participant's audio, source transcript CSV, or model adapter
to a public repository. In the research team's authorized Colab session,
use the **Colab Secrets** panel to store `MODAL_TOKEN_ID`,
`MODAL_TOKEN_SECRET` and `SAUTI_PRIVATE_ARTIFACTS_DIR` (the absolute path to
this participant\u0027s `personalization_artifacts` folder in mounted Drive), then run
this isolated upload cell:

```python
%pip install "modal>=1,<2"
import os
from pathlib import Path
from google.colab import userdata
import modal

os.environ["MODAL_TOKEN_ID"] = userdata.get("MODAL_TOKEN_ID")
os.environ["MODAL_TOKEN_SECRET"] = userdata.get("MODAL_TOKEN_SECRET")
# Store this private directory path in Colab Secrets. Never publish it.
private_root = Path(userdata.get("SAUTI_PRIVATE_ARTIFACTS_DIR"))
volume = modal.Volume.from_name(
    "sauti-adapt-private-adapters", create_if_missing=True
)

for language in ("en-KE", "sw-KE"):
    adapter = private_root / "private_adapters" / language / "best_adapter"
    assert (adapter / "adapter_model.safetensors").is_file()
    assert (adapter / "adapter_config.json").is_file()
assert (private_root / "model_manifest.json").is_file()

with volume.batch_upload() as batch:
    for language in ("en-KE", "sw-KE"):
        adapter = private_root / "private_adapters" / language / "best_adapter"
        batch.put_directory(str(adapter), f"/pilot/{language}/best_adapter")
    batch.put_file(str(private_root / "model_manifest.json"),
                   "/pilot/model_manifest.json")
print("Private adapter transfer completed; no audio uploaded.")
```

This transfer is a separate, explicitly authorized action. Ensure the
`model_manifest.json` corresponds to the adapter files being uploaded.
The private GPU worker verifies the manifest's CDLI base repository, exact
revision and adapter files at startup. If anything differs, it fails closed.
After new adapter uploads, restart or redeploy warmed Modal workers so they
reload their mounted volume and select the new revision.

## 3. Deploy GPU source code

The repository already has a manual workflow:
GitHub Actions > **Deploy CDLI Whisper GPUs to Modal** > Run workflow.

Set `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` as GitHub environment secrets
in the protected `speech-gpu` environment. Review the code change and
execute the workflow. It deploys `ml/modal/server.py`. Confirm the deployed
HTTPS URL from Modal, and perform a private authenticated health/inference
test with non-sensitive consented clips. The worker requires
`Authorization: Bearer <SAUTI_GPU_BEARER_TOKEN>` and returns transcription
only. It does not store transient input audio intentionally.

## 4. Configure the existing Railway speech-api service

Only after the Modal worker and private adapter volume are verified, set
these service-side variables (as secrets where applicable):

```env
SAUTI_MODAL_URL=https://<actual Modal HTTPS endpoint>
SAUTI_MODAL_BEARER_TOKEN=<the GPU service bearer from Modal secret>
SAUTI_COMPARE_ENABLED=true
SAUTI_PERSONALIZED_COMPARE_ENABLED=true
SAUTI_PILOT_PROFILE_ID=<the participant-owned UUID from the authorized Sauti session>
```

The pilot profile ID MUST be the actual participant profile returned by the
backend, not a shared name or an invented UUID. One pilot profile can select
the private adapter; other profiles are denied. Disable
`SAUTI_PERSONALIZED_COMPARE_ENABLED` immediately if authorization or model
review fails.

**Keep `SPEECH_MODE=mock`** until separate participant command clips have
passed false activation and accuracy evaluation, and a safe production
command release is implemented. Do not change `SPEECH_MODE` to a hypothetical
personalized Whisper mode; no such command release exists in this PR.

The Railway API is currently running an older successful deployment while a
later one failed because Railway's buildkit daemon was unavailable. Retry
the build only after code review; check environment health and deploy logs.
Do not assume the failed deploy means the current API is offline.

## 5. Test in Sauti Adapt (without executing commands)

On `https://sauti-adapt.vercel.app/admin` with the participant's authorized
session, verify that **Model comparison** is enabled, then select one of:

* Pilot personalized English LoRA (research only), with English selected.
* Pilot personalized Kiswahili LoRA (research only), with Kiswahili selected.

Provide explicit one-time comparison consent and record a short command.
Inspect the returned transcript, model identity, latency, false activations
and rejection behavior. A result status `accepted` is a **comparison label**;
the endpoint always returns `executed_action: false`.

Test the original CDLI model with the same spoken phrases and environment.
Document failures, wrong transcriptions and latency. Do not expose participant
model files or raw speech to public error logs.

## 6. Promotion to functional laptop controls

The Sauti web app already uses the **official AI4A11y Controller** for actions
within its authorized page surface. Once a *separate* command release has been
validated, the existing /v1/recognize response contract can connect accepted
commands to the Controller. No speech-driven actions should be enabled before
that release and an explicit participant-controlled consent mechanism.

A browser website cannot operate arbitrary applications across the laptop.
To control other Chrome tabs, the independently maintained extension needs
permissions, command transport, origin checks and a capability allowlist.
Controlling operating-system applications requires a separate native desktop
agent, narrowly scoped operating-system accessibility permissions and a
reliable emergency stop. Neither whole-laptop control nor this companion
agent has been shipped by this integration.

## Rollback and deletion

Disable `SAUTI_PERSONALIZED_COMPARE_ENABLED` on Railway to make personalized
comparisons unavailable without interrupting existing speech APIs. Revert the
feature PR if necessary. On consent withdrawal, separately remove the
participant adapter files from the private Modal Volume (and revoke pilot
profile binding), alongside existing participant recordings and evaluation
copies according to the approved retention policy.
