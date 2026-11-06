# Local development

Status: Docker Compose smoke test NOT VERIFIED in this environment.
This configuration deliberately runs the speech API in `mock` mode, so
unrecognised audio cannot execute any Controller action.

## One command after local secret configuration

Create an ignored root `.env` file with strong, unique credentials:

```text
SAUTI_API_TOKEN=<random private credential>
SAUTI_TOKEN_PEPPER=<different private credential>
SAUTI_STORAGE_KEY=<Fernet key>
SAUTI_SESSION_KEY=<independent base64url 32-byte secret>
```

Do not copy these example placeholders into a running environment.
Do not commit the file or paste real values into an issue, terminal log or chat.
Generate the Fernet key in a trusted local environment using the command
documented in `services/speech-api/.env.example`.

```sh
make dev
```

Then open `http://localhost:3000`. Both services bind to the local
loopback interface. Account provisioning and microphone enrolment are off,
and model recognition rejects all commands in mock mode.

To stop, press Ctrl+C and run `make down`.

## Optional smoke checks

After setting `SAUTI_API_TOKEN` in the local environment:

```sh
python scripts/smoke_deployment.py --url http://127.0.0.1:8000
```

This only checks health and authenticated readiness. The optional
`--mock-recognition` flag requires a disposable test user's id and token,
set through the environment. It uploads generated silence, not human audio.
This is not an inference accuracy test.

## Unverified

* Full local Docker build and service launch
* Account enrolment and deletion from a disposable test account
* Persistent storage recovery across restarts
* GPU inference, participant speech and real controller commands
* Toolkit checksum archive fallback during external outages
