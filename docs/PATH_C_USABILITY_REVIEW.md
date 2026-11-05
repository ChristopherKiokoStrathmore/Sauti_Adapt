# Path C: guided accessible journey and usability validation

**Status:** Engineering implementation and automated tests in progress. This is an evidence log, not evidence of human usability testing or human consensus.

## Explicit distinction

The design "board" is a *fictional evaluation exercise* using the perspectives associated with Steve Jobs, Jony Ive, Don Norman, and Kat Holmes. No review, permission or endorsement was obtained from any of them. A fifth perspective may only be described as an actual participant or disabled co-designer **after** that person has participated and consented. Never invent a participant, an interview, a score or test findings.

## Design decision

Path C is the candidate chosen for implementation, subject to accessibility validation. Its goals are:

1. Welcome with a single prominent action and optional spoken guidance.
2. Choose English or Kiswahili, with command and motor preferences available on request.
3. Review voice storage terms and explicitly consent; create the private participant account invisibly.
4. Record comfortable phrases, listen before uploading, retry or delete unsaved clips, and save three examples.
5. Clearly distinguish stored recordings from a validated recognition model.
6. Practise the accessibility toolkit without executing unapproved voice commands.
7. Finish without requiring a technical Chrome extension setup; make the extension a research-only optional step.

The interface currently has five actual wizard steps following the welcome screen. The seven conceptual moments above are not a claim about seven separate screens.

## Engineering A versus B versus C tests

Use deterministic, opt-in URL parameters:
* `/?journey=a`: previous full preferences, full extension setup
* `/?journey=b`: optional advanced preferences, safe experimental completion
* `/?journey=c`: guided accessibility controls at recording, natural speaking prompts, explicit recognition readiness and optional extension setup

The default is C. These are comparison fixtures, **not real randomized A/B tests**. No personal data, outcomes or browsing behaviour are automatically collected for research.

Check with `npm run test:e2e`:
* Navigability, stepper, call to action and language choices.
* Explicit consent, no recording before consent, minor age restriction pending verified guardian flow.
* Automatic provisioned account and secure browser session, return after refresh.
* Recording start and stop, automatic stop option, separate controls, clip review, retry, explicit save.
* Safe rejection of microphone permission errors.
* Three saved examples and automatic transition to the recognition explanation.
* Recognition not ready in mock mode, safe manual accessibility controls and no false success indication.
* Deletion and retention controls.
* Public research dashboard without participant secrets.
* Mobile viewport, keyboard focus, large targets and reduced motion.
* Browser extension origin restrictions, no action after rejection or navigation while processing.

## Fictional board, independent heuristic review

| Perspective | What it inspects | Criteria for a strong result | Known issue or concern |
| --- | --- | --- | --- |
| Product simplicity inspired by Steve Jobs | Time and decisions before first useful recording | A clear first action, few mandatory fields, no extension prerequisites | Privacy terms are necessarily detailed and some account rules remain |
| Visual refinement inspired by Jony Ive | Focus, typography, contrast and coherent interaction surfaces | High visual clarity without distracting animation or visual deception | Dark hero must not compete with the actual recording action |
| Interaction review inspired by Don Norman | Affordance, feedback, error recovery, completion | Every operation visibly says what happened and what happens next | Saved recordings are not the same as a trained model |
| Inclusive design inspired by Kat Holmes | Motor effort, alternatives, pacing, assistive technology | Adjustable duration, large buttons, visible focus, retries, no speed pressure | Automated tests do not cover switches or all assistive technologies |
| Actual participant with cerebral palsy | Real comprehension, fatigue, independence and personal comfort | Direct consented observation, meaningful feedback in their words | **Not performed**. No simulated stand-in can supply a human usability score |

A unanimous score above 95 from fictional perspectives, if ever shown, only reflects a heuristic rubric. **It must not be advertised as evidence of accessibility.** Do not score the actual participant row until sessions occur.

## Genuine usability study to perform with consenting participants

The research team should recruit a varied group of adult participants with cerebral palsy and speech/motor differences, including people who use alternative input devices. Ensure each person understands the study, their rights, voice data storage, and voluntary withdrawal. Provide screen reader or assistive switch support and a longer session or breaks whenever requested. Recruitment, accommodation and consent require actual human coordination.

Participants should independently attempt:

1. Explain in their own words what Sauti does and what happens to their voice.
2. Start setup, select a familiar language and find spoken instructions.
3. Find recording duration and adjust it without physical strain.
4. Choose consent or decline and explain the consequences.
5. Record, review, discard and re-record a phrase, then save a chosen sample.
6. Find out whether real voice recognition is ready or still being prepared.
7. Use a demonstration accessibility command without triggering unwanted actions.
8. Return after leaving and locate the delete voice data control.

Do not demand users complete tasks quickly; record task completion, necessary assistance, input errors, unexpected touches, use of breaks, physical fatigue reported voluntarily and comprehension of readiness and consent. Collect feedback anonymously where feasible and do not record diagnoses or voice samples as a usability research byproduct without separate consent.

### Success criteria and stopping rules

Evaluate all critical workflows individually, not by a cosmetic aggregate percentage. Block release if any participant cannot decline recording, revoke consent, delete data, or tell when speech is actively recording. Make specific changes, retest them and log outcomes. A heuristic score above 95 alone cannot certify real world accessibility.

## Technical limitations still outstanding

The public research dashboard is intentionally not an administrative credential vault. Cloud recognition modes and availability must be checked at test time. Profile enrollment and sample upload do not mean that the personalized ML model is trained. The browser extension currently needs technical pairing. Verified guardian consent for minors, cross-device recovery and representative human usability validation remain separate product work.

## Audit record template

For each test round capture: date, app commit SHA, device/browser, consent obtained, participant chosen pseudonym, task identifier, completion (yes/no/with help), observed difficulty, participant's own feedback, prioritized fix, retest result, and any accessibility accommodation used voluntarily. Keep personally identifying information in protected research records, not in the public repository.
