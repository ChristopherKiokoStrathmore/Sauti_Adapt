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

## Speech API

Run the image with a volume at `/data` and these variables:

| Variable | Purpose |
| --- | --- |
| `SAUTI_API_TOKEN` | Same service credential as Vercel `SPEECH_API_TOKEN` |
| `SAUTI_ACCOUNTS` | JSON object of user UUID to the sha256 hex of that person's access token. The token itself is not stored. |
| `SAUTI_STORAGE_KEY` | Fernet key. Audio, prototypes, and `model.json` are encrypted with it. |
| `SAUTI_PRIVATE_DIR` | `/data` on the volume. The process refuses a path inside the git checkout. |
| `SPEECH_MODE` | `mock` until a validated personal model exists. `mock` rejects every recording. |
| `ALLOW_ENROLLMENT` | `false` until the person is ready to record. Deletion still works when this is false. |
| `SAUTI_RETENTION_DAYS` | Default 30. Older clips are removed on the next enrollment for that profile. |
| `SAUTI_RATE_LIMIT_PER_MINUTE` | Default 30 requests per user per process. Put a second limit on the host if more than one process runs. |
| `SAUTI_ALLOWED_ORIGINS` | Origins allowed to call the API directly. Leave empty when only the Next.js server calls it. |
| `SAUTI_ENCODER_ID` | Default `facebook/wav2vec2-base`. The encoder stays frozen. |

Generate values locally. Do not commit them.

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
python -c "import hashlib,uuid; u=uuid.uuid4(); t='replace-with-a-person-token'; print(u, hashlib.sha256(t.encode()).hexdigest())"
```

The third command prints a user id and the hash to put in `SAUTI_ACCOUNTS`. Give the person the token through a private channel. The browser sends the user id and token. The shared demo passphrase is no longer accepted.

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
