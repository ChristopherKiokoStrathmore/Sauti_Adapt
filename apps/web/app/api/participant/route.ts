import { type NextRequest, NextResponse } from 'next/server';
import { originAllowed, forwardedClientIp } from '../../../lib/proxy';
import { PARTICIPANT_COOKIE, readParticipantSession, sealSession, sessionCookieOptions } from '../../../lib/participant-session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return NextResponse.json(
    { authenticated: Boolean(readParticipantSession(request)) },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return Response.json({ error: 'Origin is not allowed.' }, { status: 403 });
  if (readParticipantSession(request)) {
    return Response.json({ status: 'ready' }, { headers: { 'cache-control': 'no-store' } });
  }
  const base = process.env.SPEECH_API_URL;
  const secret = process.env.SPEECH_API_TOKEN;
  if (!base || !secret) return Response.json({ error: 'Speech service is unavailable.' }, { status: 503 });
  let payload: { age?: unknown; consent?: unknown; termsVersion?: unknown };
  try { payload = await request.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
  const age = payload.age;
  if (!Number.isInteger(age) || Number(age) < 18 || Number(age) > 120) {
    return Response.json({ error: 'Recording for children requires a separate verified guardian consent process.' }, { status: 403 });
  }
  if (payload.consent !== true || payload.termsVersion !== '2026-11-v1') {
    return Response.json({ error: 'Current voice data terms and consent are required.' }, { status: 403 });
  }
  const ip = forwardedClientIp(request.headers.get('x-forwarded-for'), request.headers.get('x-real-ip'));
  try {
    const response = await fetch(new URL('/v1/participants', base), {
      method: 'POST',
      headers: { 'x-api-key': secret, 'content-type': 'application/json', ...(ip ? { 'x-sauti-client-ip': ip } : {}) },
      body: JSON.stringify({ age, consent: true, terms_version: payload.termsVersion }),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return Response.json(
      { error: 'Could not create your private voice profile right now.' },
      { status: response.status, headers: { 'cache-control': 'no-store' } },
    );
    const body: { user_id?: string; token?: string } = await response.json();
    const session = sealSession(body.user_id || '', body.token || '');
    const result = NextResponse.json({ status: 'ready' }, { headers: { 'cache-control': 'no-store' } });
    result.cookies.set(PARTICIPANT_COOKIE, session, sessionCookieOptions);
    return result;
  } catch {
    return Response.json({ error: 'Could not create your private voice profile. Please try again.' }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!originAllowed(request)) return Response.json({ error: 'Origin is not allowed.' }, { status: 403 });
  const result = NextResponse.json({ status: 'signed_out' }, { headers: { 'cache-control': 'no-store' } });
  result.cookies.set(PARTICIPANT_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  return result;
}
