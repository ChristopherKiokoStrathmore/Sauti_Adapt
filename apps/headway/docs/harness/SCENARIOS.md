# Headway Harness: scenarios

Each scenario is an acceptance test. A work package is done when its scenarios pass on the
**fixture sites** (`apps/headway/test/fixtures/sites/`, built in WP0) and, for signed-out
pages, on the real site. Login, forms and payments are tested on fixtures only: **never**
with real accounts or real credentials.

Path: **A** = her alias or site phrase · **G** = grammar · **AI** = Gemini lane v2 · **Ask** = clarify.

## Navigation

| ID | She says (en / sw) | Starting page | Path | Must happen | Must not happen |
|---|---|---|---|---|---|
| N1 | "Open eCitizen" / "Fungua eCitizen" | any | G + known sites | Current tab opens accounts.ecitizen.go.ke; she hears "Opening eCitizen" | No Gemini call; no new tab unless she said "new tab" |
| N2 | "Go back" / "Rudi nyuma" | any | G | Tab goes back | – |
| N3 | "Next tab" / "Kichupo kifuatacho" | 2+ tabs | G | Next tab becomes active | – |
| N4 | "Search for KRA PIN" / "Tafuta KRA PIN" | any | G | `chrome.search.query` with her default engine | Typing into the page's own search box |
| N5 | "Open my KRA" | any | A (site phrase she taught) | Opens the URL she saved | – |
| N6 | any command on `chrome://settings` | protected page | – | "Headway can't work on this page" | Silent failure |

## Reading and moving

| ID | She says | Path | Must happen | Must not happen |
|---|---|---|---|---|
| R1 | "Scroll down" / "Shuka chini" | G | Page scrolls about 80% of the viewport | – |
| R2 | "Read this to me" / "Nisomee" | G | Main text read in her feedback channel; "stop" stops it | Reading menus and cookie banners first |
| R3 | "Make it bigger" / "Kuza" | G | Zoom +25% | – |
| R4 | "Take me to the services" (no such words on the page) | AI | Scrolls to or focuses the services section, found from affordance names | Page body text sent to Gemini |

## Clicking

| ID | She says | Page | Path | Must happen | Must not happen |
|---|---|---|---|---|---|
| C1 | "Click Apply for a Passport" | eCitizen home | G | Activates that exact tile | Activating "Apply for a Birth Certificate" |
| C2 | "I need a police clearance" | eCitizen home | AI | Picks "Apply for Certificate of Good Conduct" (her words aren't on the page) | Any click when the model's id is not in the current affordances |
| C3 | "Open the certificate one" | eCitizen home | Ask | Numbers the 3 certificate tiles **on the page** and in the panel; nothing runs until she picks | Clicking the first match |
| C4 | "Sign in" | DCI login (Login with eCitizen / Login with OTP / header LOGIN) | Ask | 2–3 numbered choices | Substring-first click |
| C5 | "Click the skip button" | fixture page that ignores synthetic clicks | G | Trusted click via `chrome.debugger` works | – |

## Forms, numbers and secrets (fixture sites only)

| ID | She says | Field | Path | Must happen | Must not happen |
|---|---|---|---|---|---|
| F1 | "Type my ID number one two three four five six seven eight" | ID number textbox focused | G (numbers) | Field = `12345678`; read-back "ending in 7 8" | ID number in history, logs, Gemini or the Librarian |
| F2 | "Namba yangu ni moja mbili tatu…" | same | G (sw numbers) | Same as F1 | – |
| F3 | "Enter my password" | password field | §5.2 | Offers: Chrome saved password, then Digital ID / OTP route | Asking her to say the password when secret dictation is off |
| F4 | (secret dictation ON for this site) dictates password | password field | §5.2 | Typed into the field; "8 characters entered"; take not saved | Transcript anywhere but the field |
| F5 | "Choose Nairobi" | county select | G / AI | Option chosen | – |
| F6 | "Tick I agree" | checkbox | G | Checked | – |
| F7 | "Submit" / "Tuma" | form with Pay KSh 1,050 button | G | "Send this form? The button says *Pay KSh 1,050*." Waits for yes | Submitting without a yes, even with confirm = never (D2) |
| F8 | "Yes" / "Ndiyo" after F7 | – | – | Submits; reads the result page title | – |
| F9 | anything except yes after F7 | – | – | Cancels; "Not sent" | – |

## Multi-step (AI plan, at most 4 steps, observed between steps)

| ID | She says | Must happen | Must not happen |
|---|---|---|---|
| P1 | "Open eCitizen and find the good conduct certificate" | open → wait for load → activate the Good Conduct tile → stop at the login page and say where she is | Continuing into login on its own |
| P2 | "Go to KRA and search for PIN checker" | open → focus the site search → type → press Enter (change-level) | Submitting a form that is not a search |
| P3 | Any plan where a step's target disappears after the page changes | Stop; "The page changed: did you mean…" | Guessing a new target |

## Repair and control

| ID | She says | Must happen |
|---|---|---|
| X1 | "Stop" / "Simama" | Cancels speech, plan and listening at once |
| X2 | "Undo" / "Rudisha" | Undoes the last setting change, or goes back after a navigation |
| X3 | "What can I say?" / "Naweza kusema nini?" | Lists her commands for this page, short |
| X4 | Mumbled or empty | "I didn't catch that", with the transcript; nothing runs |
| X5 | Picks choice 2 after "Did you mean" and ticks "Remember" | A Librarian proposal she accepted becomes an alias; the next time it's instant (path A) |

## Measures (on her recordings and on fixtures)

| Measure | Target | How |
|---|---|---|
| Understood first time, held-out takes | report only, no target until we have her baseline | eval harness (WP6) |
| Wrong action run | **0** | every scenario's "must not" column |
| Cut off before she finished | report | eval harness, her takes |
| Latency per path (A/G vs AI) | §6 budget | history timings |
