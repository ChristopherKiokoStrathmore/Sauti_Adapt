import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';

export const PARTICIPANT_COOKIE = 'sauti-voice-session';
const MAX_AGE_SECONDS = 60 * 60 * 24;
type ParticipantSession = { user: string; token: string; profileId: string; expires: number };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyIdPattern = /^[a-zA-Z0-9_]{1,32}$/;

function decodeKey(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9+/_=-]+$/.test(value)) {
    throw new Error('Speech session encryption is not configured.');
  }
  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32) throw new Error('Speech session encryption requires a 32 byte key.');
  return key;
}

function currentKey(): { id: string; key: Buffer } {
  const id = process.env.SAUTI_SESSION_KID || '';
  if (!keyIdPattern.test(id)) throw new Error('Speech session encryption key id is not configured.');
  return { id, key: decodeKey(process.env.SAUTI_SESSION_KEY || '') };
}

function keyFor(id: string): Buffer {
  const current = currentKey();
  if (id === current.id) return current.key;
  const raw = process.env.SAUTI_SESSION_PREVIOUS_KEYS || '{}';
  let old: unknown;
  try { old = JSON.parse(raw); } catch { throw new Error('Invalid speech session key rotation configuration.'); }
  if (!old || typeof old !== 'object' || Array.isArray(old)) throw new Error('Invalid key rotation configuration.');
  const previous = (old as Record<string, unknown>)[id];
  if (!keyIdPattern.test(id) || typeof previous !== 'string') throw new Error('Unrecognised session encryption key.');
  return decodeKey(previous);
}

export function assertSessionConfiguration(): void {
  const current = currentKey();
  if (process.env.SAUTI_SESSION_PREVIOUS_KEYS) {
    const previous = JSON.parse(process.env.SAUTI_SESSION_PREVIOUS_KEYS) as Record<string, unknown>;
    if (!previous || Array.isArray(previous) || typeof previous !== 'object'
        || Object.entries(previous).some(([id, key]) => !keyIdPattern.test(id)
        || id === current.id || typeof key !== 'string' || decodeKey(key).length !== 32)) {
      throw new Error('Invalid session key rotation configuration.');
    }
  }
}

export function sealSession(user: string, token: string, profileId: string): string {
  if (!uuidPattern.test(user) || !uuidPattern.test(profileId) || token.length < 32 || token.length > 256) {
    throw new Error('Speech service returned invalid participant credentials.');
  }
  const current = currentKey();
  const data: ParticipantSession = { user, token, profileId, expires: Date.now() + MAX_AGE_SECONDS * 1000 };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current.key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return current.id + '.' + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function readParticipantSession(request: NextRequest): { user: string; token: string; profileId: string } | null {
  const value = request.cookies.get(PARTICIPANT_COOKIE)?.value || '';
  if (!value || value.length > 1024) return null;
  try {
    const dot = value.indexOf('.');
    if (dot < 1) return null;
    const id = value.slice(0, dot);
    const sealed = Buffer.from(value.slice(dot + 1), 'base64url');
    if (sealed.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyFor(id), sealed.subarray(0, 12));
    decipher.setAuthTag(sealed.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as Partial<ParticipantSession>;
    if (!uuidPattern.test(parsed.user || '') || !uuidPattern.test(parsed.profileId || '')
        || typeof parsed.token !== 'string' || parsed.token.length < 32
        || typeof parsed.expires !== 'number' || parsed.expires <= Date.now()) return null;
    return { user: parsed.user as string, token: parsed.token, profileId: parsed.profileId as string };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: MAX_AGE_SECONDS,
};
