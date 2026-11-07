"""Service credentials for the CDLI Modal GPU endpoint.

Kept free of Modal and FastAPI imports so it can be unit tested in CI.

Two kinds of caller are accepted, each with its own bearer token:
  - the Sauti speech API (Modal Secret 'sauti-gpu-auth', SAUTI_GPU_BEARER_TOKEN)
  - partner teams (Modal Secret 'sauti-gpu-partner-auth',
    SAUTI_GPU_PARTNER_TOKENS="team-a:<token>,team-b:<token>")

Each partner has a separate token, so one team can be revoked without
touching the speech API or the other teams. Only the label is ever logged.
"""
import hmac
import re

SPEECH_API_LABEL = "sauti-speech-api"
MIN_TOKEN_LENGTH = 32
_LABEL = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def parse_partner_tokens(spec: str) -> dict:
    """Parse 'label:token,label:token'. Raises ValueError on any malformed entry."""
    partners = {}
    for entry in (spec or "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        label, sep, token = entry.partition(":")
        label, token = label.strip(), token.strip()
        if not sep or not _LABEL.match(label):
            raise ValueError("Partner labels must be lowercase letters, digits or '-'.")
        if label == SPEECH_API_LABEL or label in partners:
            raise ValueError("Partner labels must be unique.")
        if len(token) < MIN_TOKEN_LENGTH:
            raise ValueError("Partner tokens must be at least %d characters." % MIN_TOKEN_LENGTH)
        partners[label] = token
    if len(set(partners.values())) != len(partners):
        raise ValueError("Each partner needs its own token.")
    return partners


def authorized_caller(authorization: str, speech_api_token: str, partner_spec: str):
    """Return the caller label for a valid bearer header, otherwise None.

    A malformed partner configuration disables partner access only (fail
    closed); the speech API token keeps working.
    """
    credentials = {}
    if len(speech_api_token or "") >= MIN_TOKEN_LENGTH:
        credentials[SPEECH_API_LABEL] = speech_api_token
    try:
        partners = parse_partner_tokens(partner_spec)
    except ValueError:
        partners = {}
    for label, token in partners.items():
        if token != speech_api_token:
            credentials[label] = token
    supplied = (authorization or "").encode()
    match = None
    # Compare against every credential so timing does not reveal which matched.
    for label, token in credentials.items():
        if hmac.compare_digest(supplied, ("Bearer " + token).encode()):
            match = label
    return match
