import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';

export const PARTICIPANT_COOKIE = 'sauti-voice-session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
type ParticipantSession = { user: string; token: string; profileId: string; expires: number };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secretKey(): Buffer {
  const backendKey = process.env.SPEECH_API_TOKEN || '';
  if (backendKey.length < 16) throw new Error('Speech session encryption is not configured.');
  return createHash('sha256').update('sauti-participant-cookie-v1:').update(backendKey).digest();
}

export function sealSession(user: string, token: string, profileId: string): string {
  if (!uuidPattern.test(user) || !uuidPattern.test(profileId) || token.length < 32 || token.length > 256) {
    throw new Error('Speech service returned invalid participant credentials.');
  }
  const data: ParticipantSession = { user, token, profileId, expires: Date.now() + MAX_AGE_SECONDS * 1000 };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function readParticipantSession(request: NextRequest): { user: string; token: string; profileId: string } | null {
  const value = request.cookies.get(PARTICIPANT_COOKIE)?.value || '';
  if (!value || value.length > 1024) return null;
  try {
    const sealed = Buffer.from(value, 'base64url');
    if (sealed.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), sealed.subarray(0, 12));
    decipher.setAuthTag(sealed.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as Partial<ParticipantSession>;
    if (!uuidPattern.test(parsed.user || '') || !uuidPattern.test(parsed.profileId || '') || typeof parsed.token !== 'string' || parsed.token.length < 32
        || typeof parsed.expires !== 'number' || parsed.expires <= Date.now()) return null;
    return { user: parsed.user as string, token: parsed.token, profileId: parsed.profileId as string };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_AGE_SECONDS,
};
