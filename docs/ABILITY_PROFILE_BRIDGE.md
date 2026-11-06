# Sauti Adapt: AI4A11y Librarian profile bridge

This browser integration uses the pinned official toolkit API `createToolkit({kv})`,
`librarian.setProfileFields`, `librarian.getAbilityModel`, and the Controller's
`loadPresentation`. It never imitates a Librarian and does not change toolkit source.

## Consent and data boundaries
The participant explicitly selects **Share my preferences with the toolkit**.
Before that action, no toolkit profile is written. The approved fields are:

* Selected language (`en-KE` or `sw-KE`)
* User-selected spoken guidance preference
* Headway mouth/dwell selection preference
* Headway pointer sensitivity and steadiness

These preferences are stored in the website origin's `localStorage` through
the toolkit's injected KV port. The toolkit `sync` area is implemented with
local browser storage for this website: it is **not** Chrome `storage.sync`.
The participant may explicitly export and import the sanitized `AbilityModel`
JSON. No automatic cross-device synchronization has been implemented.

Private Sauti `profile_id`, `user_id`, authentication tokens, voice
recordings, embeddings, model weights, age, medical conditions and diagnoses
are deliberately excluded from every toolkit write and exported JSON.
A participant's voice account is not automatically linked to the browser
preferences. The two data stores remain separately managed.

**Revocation** deletes every local browser KV key under
`sauti.ability.v1.` and immediately returns Controller presentation
to its non-personalized default. This does not delete the separately
consented speech recordings; the voice data deletion flow remains distinct.

No voice enrollment or speech API connection is required to use the local
preference bridge. No remote profile, cloud storage, identity linkage,
upstream PR or automatic model fine tuning is implied.

## Test locally
1. Open the website and Step 1, select English/Kiswahili and Headway settings.
2. Click **Share my preferences with the toolkit**.
3. Change a preference and reload. Verify the toolkit profile persists locally.
4. Export JSON. Verify only allowed fields exist.
5. Import an approved JSON file.
6. Click **Stop sharing and delete toolkit preferences**, reload, and verify
   it no longer reports sharing enabled.

## Next stage (not part of this contribution)
A user-authenticated, consented server-side preferences resource would be
needed for genuine browser-to-device synchronization with a voice profile.
The API must enforce ownership, independent sharing consent, data minimization,
revocation, encryption and export scope. Do not send the encrypted speech
cookie or model files through a public profile-sharing endpoint.
