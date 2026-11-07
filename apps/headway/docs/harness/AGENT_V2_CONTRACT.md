# Agent v2 contract (as being built, 2026-11-07)

The first concrete step of HARNESS_SPEC §4.3. It extends the built `/v1/extension/agent/plan`;
v1 requests and plans keep working unchanged.

## Request: `POST /v1/extension/agent/plan`

```json
{
  "instruction": "I need a police clearance",          // her words, 1–400 chars (required, as v1)
  "page_url": "https://accounts.ecitizen.go.ke/en",     // as v1
  "page_title": "Home · eCitizen",                      // optional, ≤ 200 chars
  "affordances": [                                      // optional, ≤ 150 items
    { "id": "h7", "kind": "link", "name": "Apply for Certificate of Good Conduct", "submit": false }
  ],
  "profile": {                                          // optional, from fields.voice
    "language": "en | sw | both",
    "confirm": "always | forms | never",
    "commands": [ { "id": "scroll-down", "phrases": ["Scroll down", "Shuka chini"] } ]
  }
}
```

- `affordances[].id`: `^h[0-9]{1,5}$`. `kind`: `link | button | textbox | password | number | checkbox | radio | select | tab | other`. `name`: ≤ 80 characters. `submit`: true if activating it submits a form.
- Affordance names are **untrusted page labels**. The server puts them in the prompt inside a block marked as data, not instructions. Page body text is never sent.
- The extension **never** sends passwords, OTPs, ID numbers or typed field values. Typing is handled locally (below) and never goes to Gemini.

## Response (unchanged envelope)

```json
{ "plan": { … }, "requires_confirmation": true, "executed_action": false }
```

`plan` is one of the v1 plans (`search_web`, `open_url`, `scroll`, `read_page`, `go_back`, `none`) or:

| Plan | Fields | Server validation |
|---|---|---|
| `click` | `target_id` | must be one of the request's affordance ids |
| `focus` | `target_id` | must be one of the request's affordance ids |
| `clarify` | `question` (≤ 160), `options`: 2–3 × `{ target_id }` | every id is in the affordances, no duplicates |

Gemini is told to:
- choose `clarify` when two or more elements fit
- choose `none` for payments, money transfers, deleting, sending messages, or anything unsafe, and for typing (typing is not a Gemini action)
- never return a `submit` element **unless** her words ask to submit, send, pay or continue

The extension still read-backs and confirms every `submit` element.

## Local, before Gemini (extension)

Runs in the side panel and content script; no network:

| She says | Local result |
|---|---|
| "scroll down/up", "shuka chini", "panda juu" | scroll |
| "go back", "rudi nyuma" | back |
| "read this (to me)", "nisomee" | read page |
| "click/press/open/bonyeza/fungua \<label\>" | whole-word match on affordance names: one match → click; several → numbered choices; none → Gemini |
| "type/write/andika \<text\>" or spoken digits in either language | type into the focused text field (numbers normalised); masked read-back for number, password and OTP fields |
| "enter my password", "weka nenosiri" | never dictated: shows how to use Chrome's saved password or the site's OTP / Digital ID route |
| "one / two / three", "moja / mbili / tatu" | picks a numbered choice |
| "yes / ndiyo" · "no / hapana / cancel" | answers a pending confirmation |

## Risk and confirmation (extension)

- `submit` elements, or labels matching pay / submit / send / confirm / delete / tuma / lipa / thibitisha: **always** confirm, reading back the real label (D2).
- Other clicks and typing follow her `fields.voice.setup.confirm`: `always` → confirm; `forms` and `never` → run.
- Search, open, scroll, read and back run directly, with spoken or visible feedback.
