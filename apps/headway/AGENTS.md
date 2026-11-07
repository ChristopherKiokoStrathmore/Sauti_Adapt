# Headway: rules for anyone working here (people and coding agents)

Headway (`apps/headway`) is an audio-only Chrome extension that lets Faridah, our co-designer,
use real websites by speaking, in Kenyan English or Kiswahili, at her own pace. It is built on
the AI4A11y toolkit, with Gemini as the toolkit's language lane. The repo-wide `AGENTS.md` still applies.
Where it talks about `apps/extension`, that is Christopher's separate Sauti extension: do not
edit it for Headway work.

## Read before changing anything

1. `docs/harness/WORKFLOW.md`: setup, how to pick up work, PRs
2. `docs/harness/HARNESS_SPEC.md`: architecture, contracts, safety rules
3. `docs/harness/SCENARIOS.md`: acceptance tests
4. `docs/harness/STATUS.md`: claim a work package before starting

## Never

- Run an action when the speech, the target or the plan is unclear. Ask with numbered choices.
- Click the first of several matching elements.
- Submit, pay or send without a spoken or pressed "yes" that followed a read-back of the real button label.
- Send passwords, OTPs, ID numbers, recordings or page body text to Gemini. Store secrets anywhere.
- Put a token or API key in the extension, the repo, a log, a PR or a chat.
- Fake a transcript, a reading or a metric. "Not available" is a valid result.
- Infer what she can do from a diagnosis. Use her onboarding answers.
- Edit `vendor/` (pinned toolkit) or commit recordings or personal data.

## Always

- `npm run check:headway` passes before you push (and `npm run e2e:headway` once WP0 lands).
- Write the scenario test first; claim scenario IDs in the PR.
- Keep `src/toolkit-next/` portable (types only, no Headway imports): it goes upstream.
- Log bottlenecks in `Research/NNN-*.md`; mark something as working only after a person has used it.
