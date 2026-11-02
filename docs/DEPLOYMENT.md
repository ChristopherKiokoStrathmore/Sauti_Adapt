# Deployment preparation

Nothing in this repository has been deployed. Do not create hosted resources from these notes until the accounts below exist. Vercel can serve the Next.js app. It cannot run the FastAPI speech API: that process needs Python, a persistent disk, and enough memory for a frozen Wav2Vec2 encoder when `SPEECH_MODE=prototype`.

## Recommended split

| Piece | Host | Why |
| --- | --- | --- |
| `apps/web` | Vercel | Static and server routes, no model weights |
| `services/speech-api` | A Fly.io machine with a persistent volume mounted at `/data` | The Dockerfile in `services/speech-api` runs uvicorn. A volume holds encrypted clips and models outside git. A single Ubuntu VM running that image is the fallback if Fly.io is not used. |

The Chrome extension is loaded unpacked for now. Publishing it to the Chrome Web Store is a later account, not part of this setup.

## Vercel

In the Vercel project, set **Root Directory** to `apps/web`. `apps/web/vercel.json` installs from the repository root, bootstraps the pinned AI4A11y toolkit, and builds the Next.js app. The toolkit is fetched at build time and is not committed.

Environment variables for the Vercel project. Do not prefix them with `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `SPEECH_API_URL` | Base URL of the speech API, for example `https://sauti-api.fly.dev` |
| `SPEECH_API_TOKEN` | Service credential sent only from the Next.js server to the API |
| `SAUTI_ALLOWED_ORIGINS` | Comma-separated browser origins. Include the Vercel origin and `chrome-extension://<extension-id>`. If empty, only the app's own host is allowed. |

Vercel project settings:

* Root Directory: `apps/web`
* Framework: Next.js
* Install command: `cd ../.. && npm install` (the monorepo root, so `packages/shared` is installed)
* Build command: `cd ../.. && python3 scripts/bootstrap_toolkit.py && npm run build:web`

The build must run `scripts/bootstrap_toolkit.py`. The pinned AI4A11y toolkit is gitignored, and the web app imports it. `apps/web/vercel.json` already sets those two commands. Do not put secrets in `vercel.json`.

The extension is not built by Vercel. `apps/extension/public/sidepanel.html` defaults the PWA origin field to `http://localhost:3000`. For a staging deploy, set that field to the Vercel URL before use. `apps/extension/public/manifest.json` already grants host access to `https://*.vercel.app/*`, plus localhost. Rebuild with `npm run build:extension` after any manifest change. The sidepanel stores the chosen origin in `chrome.storage.local` under `apiOrigin`.

## Speech API on Fly.io

These commands are the procedure. This repository does not run them.

```bash
cd services/speech-api
fly apps create sauti-adapt-speech
fly volumes create sauti_data --region jnb --size 1 -a sauti-adapt-speech
fly secrets set \
  SAUTI_API_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')" \
  SAUTI_TOKEN_PEPPER="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')" \
  SAUTI_STORAGE_KEY="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')" \
  SAUTI_ACCOUNTS='{"USER-UUID":"HMAC-HEX"}' \
  SAUTI_ALLOWED_ORIGINS='https://your-app.vercel.app' \
  -a sauti-adapt-speech
fly deploy -a sauti-adapt-speech
```

`SAUTI_ACCOUNTS` values are HMAC-SHA256 digests, not the person's token:

```bash
python -c "import hmac,hashlib,secrets,uuid; u=uuid.uuid4(); t=secrets.token_urlsafe(32); p='the-SAUTI_TOKEN_PEPPER'; print('user', u); print('token', t); print('hmac', hmac.new(p.encode(), t.encode(), hashlib.sha256).hexdigest())"
```

Give the person the user id and token through a private channel. Put only the printed hmac in `SAUTI_ACCOUNTS`.

`services/speech-api/fly.toml` sets `primary_region = "jnb"` (Johannesburg, the closest Fly region to Kenya), `internal_port = 8000`, `force_https = true`, `min_machines_running = 1` with `auto_stop_machines = "off"` so the retention timer keeps running, `[env]` `SPEECH_MODE=mock` and `ALLOW_ENROLLMENT=false`, a `/health` check, and the `sauti_data` volume mounted at `/data`. No secret values are in that file.

## Speech API

Run the image with a volume at `/data` and these variables:

| Variable | Purpose |
| --- | --- |
| `SAUTI_API_TOKEN` | Same service credential as Vercel `SPEECH_API_TOKEN`. The browser never sees it. |
| `SAUTI_TOKEN_PEPPER` | Server secret used as the HMAC key for personal access tokens. |
| `SAUTI_ACCOUNTS` | JSON object of user UUID to `HMAC-SHA256(pepper, personal token)`. The token itself is not stored. |
| `SAUTI_STORAGE_KEY` | Fernet key. Audio, prototypes, and `model.json` are encrypted with it. |
| `SAUTI_PRIVATE_DIR` | `/data` on the volume. The process refuses a path inside the git checkout. |
| `SPEECH_MODE` | `mock` until a validated personal model exists. `mock` rejects every recording. |
| `ALLOW_ENROLLMENT` | `false` until the person is ready to record. Deletion still works when this is false. |
| `SAUTI_RETENTION_DAYS` | Default 30. At process startup, every `SAUTI_PURGE_INTERVAL_SECONDS` (default 3600), and when the owner enrolls, clips older than this are deleted along with the matching feature-cache embedding for `SAUTI_ENCODER_ID`. The released prototype files stay until the person deletes the profile. Ownership is checked before an enrollment deletes or stores anything. |
| `SAUTI_PURGE_INTERVAL_SECONDS` | Default 3600, minimum 30. How often the in-process sweep walks every profile. The counters and the sweep are per process. |
| `SAUTI_AUTH_FAIL_LIMIT_PER_MINUTE` | Default 10. Failed personal-token checks for one canonical user UUID from one client IP. Checked before the token is compared, so a locked IP cannot tell a right token from a wrong one. Failures from another IP do not lock this person out. Successful requests do not count. |
| `SAUTI_IP_RATE_LIMIT_PER_MINUTE` | Default 120. Every attempt from one client IP, success or failure. Valid traffic under this limit is not rejected by the failure bucket. In-memory per process. |
| `x-sauti-client-ip` | Set by the Next.js server from the first `x-forwarded-for` hop, or `x-real-ip`. The API uses it only when `x-api-key` matches `SAUTI_API_TOKEN`. Otherwise it uses the TCP peer address. Real Vercel header behavior is not verified in this repository. |
| `SAUTI_ALLOWED_ORIGINS` | Origins allowed to call the API directly. Leave empty when only the Next.js server calls it. |
| `SAUTI_ENCODER_ID` | Default `facebook/wav2vec2-base`. The encoder stays frozen. |

Generate values locally. Do not commit them.

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
python -c "import hmac,hashlib,secrets,uuid; u=uuid.uuid4(); t=secrets.token_urlsafe(32); p='replace-with-SAUTI_TOKEN_PEPPER'; print('user', u); print('token', t); print('hmac', hmac.new(p.encode(), t.encode(), hashlib.sha256).hexdigest())"
```

The first command prints a value for `SAUTI_API_TOKEN` or for `SAUTI_TOKEN_PEPPER`. The third command prints a user id, a 256-bit personal token, and the HMAC to put in `SAUTI_ACCOUNTS`. Give the person the user id and token through a private channel. The browser sends those two values. Next.js adds `SPEECH_API_TOKEN` only on the server-to-API call.

## Behaviour that must stay true

* Requests larger than 2.5 MB are rejected. Audio files larger than 2 MB are rejected.
* Audit lines are JSON in `$SAUTI_PRIVATE_DIR/audit.log`. They store event, outcome, and short hashes of the user and profile. They do not store audio, tokens, transcripts, or IP addresses.
* A profile can be deleted by its owner even when enrollment is off.
* `SPEECH_MODE=mock` never executes a voice command.
* Real co-designer accuracy is not verified.

## Accounts the deploy needs

1. A Vercel account with permission to create a project from this GitHub repository.
2. A Fly.io account, or an account on another VM host, with permission to run the speech-api image and attach a persistent volume.
3. DNS access only if a custom domain is required. The default Vercel and Fly hostnames are enough for a first private deploy.
4. No Hugging Face token for the current prototype path. `facebook/wav2vec2-base` is a public download when prototype mode is turned on later. The gated Kenyan speech datasets are not part of deployment.
5. No Chrome Web Store account for the unpacked extension.

This repository does not create those accounts and does not perform the deploy.
