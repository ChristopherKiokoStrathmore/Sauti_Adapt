# Toolkit issues log — Sauti Adapt (Team 4)

Issues found while preparing and testing the AI for Accessibility Toolkit for Sauti Adapt.
Each entry is a draft to file on GitHub: https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/issues

---

## 1. skill-test.js validates against a stale hard-coded adapter list

**Where:** `toolkit/test/skill-test.js` (the `REGISTRY_IDS` and `SETTINGS_META` stand-ins)
**Toolkit version:** pinned `7cf5006`; also present on current `main`
**Status:** Fixed in PR #__ (https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/pull/__). New skill that depends on it: PR #__ (https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/pull/__)

**What I did:** Added a new built-in skill (`unhurried-voice.md`) using the adapters `voice-commands`, `confirm-actions`, `big-targets` and `dismiss-overlays`, then ran `node toolkit/test/skill-test.js`.

**Expected:** The skill validates, because all four adapters and their settings exist in the real registry (`toolkit/registry/tools.js`).

**What happened:** `FAIL: unhurried-voice.md: validates against registry`, with errors `unknown adapter "confirm-actions"`, `unknown adapter "big-targets"`, `unknown adapter "dismiss-overlays"` (and their settings). The test checks skills against a hand-typed list of 18 adapter IDs, while the real registry has 46. Validating the same skill against the real registry returns `{ valid: true, errors: [] }`:

```
node --input-type=module -e "import {readFileSync} from 'fs'; import {parseSkill, validateSkill} from './toolkit/core/skill.js'; import {asAATools} from './toolkit/registry/tools.js'; const s=parseSkill(readFileSync('PATH/TO/unhurried-voice.md','utf8')); console.log(validateSkill(s,{tools:asAATools()}));"
```

**Impact:** Any new skill that uses an adapter outside the 18 stand-ins fails the test even though it is valid. This discourages skill contributions, which the README calls the best first contribution.

**Suggested fix:** Validate the real built-in skills against `asAATools()` from `toolkit/registry/tools.js`, and keep the stand-in list only for the "rejects unknown adapter / unknown setting" cases.

**Who it affects:** Contributors writing skills, especially for motor and speech needs, whose adapters (`big-targets`, `confirm-actions`, `dismiss-overlays`) are missing from the stand-in list.

**Environment:** Windows, MSYS2 UCRT64 shell, Node 24.19.0
