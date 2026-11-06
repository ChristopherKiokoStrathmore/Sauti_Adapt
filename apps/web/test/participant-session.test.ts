import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { sealSession, readParticipantSession } from '../lib/participant-session.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'test-personal-token-with-at-least-thirty-two-characters';
const saved = {
  sessionKey: process.env.SAUTI_SESSION_KEY,
  sessionKid: process.env.SAUTI_SESSION_KID,
  previous: process.env.SAUTI_SESSION_PREVIOUS_KEYS,
  speechKey: process.env.SPEECH_API_TOKEN
};

function requestWithCookie(value: string): any {
  return { cookies: { get: (key: string) => key === 'sauti-voice-session' ? { value } : undefined } };
}

before(() => {
  process.env.SAUTI_SESSION_KEY = Buffer.alloc(32, 7).toString('base64url');
  process.env.SAUTI_SESSION_KID = 'current';
  process.env.SAUTI_SESSION_PREVIOUS_KEYS = '{}';
});

after(() => {
  for (const [name, key] of Object.entries({
    SAUTI_SESSION_KEY: saved.sessionKey,
    SAUTI_SESSION_KID: saved.sessionKid,
    SAUTI_SESSION_PREVIOUS_KEYS: saved.previous,
    SPEECH_API_TOKEN: saved.speechKey
  })) {
    if (key === undefined) delete process.env[name]; else process.env[name] = key;
  }
});

test('session envelope uses an explicit key id', () => {
  const sealed = sealSession(USER, TOKEN, PROFILE);
  assert.ok(sealed.startsWith('current.'));
  assert.deepEqual(readParticipantSession(requestWithCookie(sealed)),
    { user: USER, token: TOKEN, profileId: PROFILE });
});

test('old key rotation accepts previously issued sessions', () => {
  const issued = sealSession(USER, TOKEN, PROFILE);
  const oldKey = process.env.SAUTI_SESSION_KEY!;
  process.env.SAUTI_SESSION_KEY = Buffer.alloc(32, 8).toString('base64url');
  process.env.SAUTI_SESSION_KID = 'replacement';
  process.env.SAUTI_SESSION_PREVIOUS_KEYS = JSON.stringify({ current: oldKey });
  assert.deepEqual(readParticipantSession(requestWithCookie(issued)),
    { user: USER, token: TOKEN, profileId: PROFILE });
  process.env.SAUTI_SESSION_KEY = oldKey;
  process.env.SAUTI_SESSION_KID = 'current';
  process.env.SAUTI_SESSION_PREVIOUS_KEYS = '{}';
});

test('API service token cannot substitute for missing cookie key', () => {
  const previous = process.env.SAUTI_SESSION_KEY;
  process.env.SPEECH_API_TOKEN = 'a-long-api-secret-must-not-double-as-a-cookie-secret';
  delete process.env.SAUTI_SESSION_KEY;
  assert.throws(() => sealSession(USER, TOKEN, PROFILE), /session encryption/i);
  process.env.SAUTI_SESSION_KEY = previous;
});

test('unknown or changed session key rejects without throwing', () => {
  const old = sealSession(USER, TOKEN, PROFILE);
  process.env.SAUTI_SESSION_KEY = Buffer.alloc(32, 9).toString('base64url');
  assert.equal(readParticipantSession(requestWithCookie(old)), null);
  process.env.SAUTI_SESSION_KEY = Buffer.alloc(32, 7).toString('base64url');
});
