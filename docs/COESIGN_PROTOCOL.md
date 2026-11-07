# Sauti Adapt co-design research protocol

Status: **PROPOSED PLAN ONLY**. No session, consent, SUS measurement or
participant accuracy result is represented as completed.

## Research objective

Evaluate whether the participant can reliably use Sauti's permitted
English and Kiswahili speech commands, understand rejection feedback,
recover after errors, and choose whether AI4A11y or Headway controls
are appropriate for their own needs. Do not infer capability from a diagnosis.

## Required authorisations before collecting data

* A project owner and a designated human ethics lead approve the session.
* An appropriately qualified reviewer drafts participant consent and privacy
  materials, including the actual external service destinations.
* The co-designer can pause, skip, withdraw or request data deletion.
* No gated CDLI datasets or participant data leave approved storage without
  explicit project owner permission.
* Approval for microphone capture is separate from approval for retained
  audio and from approval for model improvement.

**Consent forms are not included. Their legal wording is blocked pending
the project owner's approval and review by qualified local advisers.**

## Proposed participant-led session tasks

1. The participant selects language, listening trigger and comfortable pace.
2. Test microphone permissions and a deliberate start and stop control.
3. Practise scroll, back, read and undo on the authorised Sauti workspace.
4. Test deliberately unknown phrases and background noise, with no action.
5. Practise rejection recovery, an emergency stop and returning to the task.
6. If separately authorised, evaluate the extension on approved websites,
   not arbitrary desktop applications.

## Data collection plan

Record a separate calibration and untouched test session. Keep train,
calibration and test clips distinct by hash, session and recording ID.
Measure per-attempt result: intended command, transcript, accepted/rejected
status, actual Controller action, recovery count and elapsed milliseconds.
Log no raw audio, unredacted transcripts or identifying details in CI or
third party analytics.

Collect self-reported fatigue before, during and after the session,
the participant's chosen breaks, task completion, workload observations,
and a System Usability Scale (SUS) survey where appropriate.
Capture unexpected activations separately from correctly rejected speech.
Never replace false-activation upper bounds with the point estimate zero.

## Planned analysis

* Known command recall by language and task, with denominators
* Unknown speech false accepts with a one-sided 95 per cent
  Clopper-Pearson upper confidence bound
* p50 and p95 end-to-end latency and recovery time
* Task completion, assistance requests, skipped tasks and fatigue
* SUS scores only if completed with a validated scoring procedure
* Participant comments reviewed and approved for any public sharing

## Current evidence status

All proposed real-person metrics: **NOT VERIFIED**.
A typical-speech proxy result cannot establish atypical speech usability.
