# Headway Harness: how we work

For everyone on the team and every coding agent (Claude, Codex, Gemini, Cursor…) working on
the harness. Follow it from your machine and the result works on everyone's.

## 1. Read first, in this order

1. [`../../AGENTS.md`](../../AGENTS.md): the rules for Headway (short)
2. [HARNESS_SPEC.md](HARNESS_SPEC.md): architecture, contracts, safety rules
3. [SCENARIOS.md](SCENARIOS.md): what "working" means
4. [STATUS.md](STATUS.md): who is doing what
5. The toolkit you build on: `vendor/ai4a11y-toolkit/controller/DESIGN.md`, `controller/PROTOCOL.md`, `docs/voice-mode.md`

## 2. Set up (same on every machine)

```sh
git clone git@github.com:ChristopherKiokoStrathmore/Sauti_Adapt.git && cd Sauti_Adapt
python scripts/bootstrap_toolkit.py    # pinned AI4A11y toolkit → vendor/ (verified SHA)
npm install
npm run check:headway                  # typecheck + build + tests, must pass before you start
```

Load `apps/headway` unpacked in Chrome (`chrome://extensions`, Developer mode, Load unpacked).

Secrets never go in the repo, a chat or a PR:
- **Sauti model token:** `ml/modal/.env` (`SAUTI_GPU_BEARER_TOKEN`), shared privately by Brian. Run `tools/voice-test/serve.py` (port 8790) to use it.
- **Gemini API key:** `GEMINI_API_KEY`, in Railway's Variables for the deployed speech API, and in `services/speech-api/.env` (git-ignored) for a local run. Never in the extension.
- **Participant credentials:** the Headway agent panel uses her personal user id + token from the speech API (`/v1/participants`); never a shared team code.
- **Without either:** everything still builds and the fixture tests run. Sauti and Gemini readings say "not available".

If `bootstrap_toolkit.py` says the checkout has local changes: run `git -C vendor/ai4a11y-toolkit diff`. If it's only file modes, run `git -C vendor/ai4a11y-toolkit checkout -- .`. Never edit `vendor/`.

## 3. Pick up work

1. Open [STATUS.md](STATUS.md). Choose a work package whose dependencies are **Done**.
2. Claim it: put your name and branch in its row and push that one-line change. Two people never work on one package.
3. Branch from `main`: `feature/harness-wp<N>-<short-name>`, e.g. `feature/harness-wp1-control-port`.
   Until PR #29 (Headway Voice) is merged, branch from `feature/headway-voice`.
4. Stay inside the package's folders (STATUS.md lists them). If you need to change another package's
   file or a contract in HARNESS_SPEC.md §4, stop and see §5.

## 4. Build it

Each change follows this loop:

1. **Scenario first.** Find your scenario IDs in SCENARIOS.md. Write the failing test before the code:
   - unit tests in `apps/headway/test/*.test.ts` (Node, `--experimental-strip-types`)
   - browser tests against the fixture sites in `apps/headway/test/e2e/` (WP0 provides `npm run e2e:headway`)
2. **Implement** to the contract in HARNESS_SPEC.md §4.
3. **Code in `src/toolkit-next/`** must stay portable: types only, no Headway imports, `chrome.*` only under `platforms/chrome/`.
4. **Run** `npm run check:headway` and `npm run e2e:headway`. Both must pass.
5. **Hit a bottleneck?** Write it up in `apps/headway/Research/NNN-short-name.md` (format of 001), even if you haven't solved it yet.
6. **Test by hand** on the real site, signed out only, and on the fixture site for anything with a form.

Rules that are never traded for speed:
- **Default to rejection:** unclear means nothing runs (SPEC §5.3).
- **Never fake a reading**, a transcript or a metric. "Not available" is a correct answer.
- **No secrets** in logs, history, Gemini prompts, the Librarian, test fixtures or screenshots (SPEC §5.2).
- **No real personal data** in tests: fixture sites, synthetic voices (`say -o`), and Faridah's recordings only on her consenting machine, never committed.
- **Nothing inferred from a diagnosis.** Behaviour comes from her onboarding answers.

## 5. Changing a contract

Contracts are HARNESS_SPEC.md §4 (ControlPort v2, action catalogue, Gemini lane I/O, grammar,
storage) and §5 (safety).

1. Edit the spec in your PR under a heading **Contract change**: what changes, why, and who is affected.
2. Tag the owner of every package that uses it (STATUS.md) as a reviewer.
3. Don't merge until one of them approves. Old behaviour stays working until all users have moved.

## 6. Open the PR

Title: `Harness WP<N>: <what it does>`. Body:

```
## What it does
<2–4 lines, in terms of what Faridah can now do>

## Scenarios
Passing: N1, N2, R1 …   Not yet: C3 (why)

## How it was tested
npm run check:headway: <n> passing
npm run e2e:headway: <n> passing
By hand: <site, what was tried>

## Contract change
None | <details, reviewers tagged>

## Not done / risks
<honest list>
```

- Screenshots or a short screen recording for anything visible.
- Commit messages say what changed and why. Follow the repo owner's rules on attribution. Brian's rule: no AI co-author lines.
- Update STATUS.md (Done, PR link) in the same PR.

## 7. Review checklist (for the reviewer, human or agent)

- [ ] Scenarios claimed are actually covered by tests that would fail without the change
- [ ] `check:headway` and `e2e:headway` pass on the reviewer's machine
- [ ] No ambiguous target is ever clicked; no submit runs without a yes
- [ ] No secret can reach Gemini, history, logs, storage or the Librarian
- [ ] `src/toolkit-next/` code is portable (types only, no Headway imports)
- [ ] New permissions are justified in `test/manifest.test.ts`
- [ ] Spec and STATUS updated

## 8. Upstream to the toolkit (WP7)

When a `src/toolkit-next/` module is stable (its scenarios have passed for a week of use):
1. Port it to `AI-for-Accessibility-Toolkit` on a branch (strip types, add JSDoc, move tests to the toolkit's `test/`).
2. Open the PR there, linking our spec section and the decision records (D1, D2).
3. After it merges: bump `REVISION` in `scripts/bootstrap_toolkit.py`, switch imports to the vendored path, and delete the Headway copy, all in one PR.

## 9. Where the hand-offs happen

| From | To | What is handed over |
|---|---|---|
| WP1 Control port | WP2, WP3 | `describeCapabilities` v2 and `getAffordances` working on fixtures |
| WP3 Understanding | WP4 | `understand(transcript, ctx) → Intent \| Plan \| Clarify` |
| WP4 Listening | WP3 | `onTranscript(text, readings, timings)` |
| WP2 Safety | WP3, WP4 | `check(intent, affordances, setup) → run \| confirm(label) \| refuse(reason)` |
| WP6 Eval | everyone | `npm run eval:headway` report: per-scenario pass/fail, latency per path |
