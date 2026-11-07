import { type NextRequest, NextResponse } from 'next/server';
import { originAllowed, forwardedClientIp } from '../../../lib/proxy';
import { PARTICIPANT_COOKIE, readParticipantSession, sealSession, sessionCookieOptions, assertSessionConfiguration } from '../../../lib/participant-session';

export const runtime = 'nodejs';

function checkSessionSettings(): Response | null {
  if (process.env.NODE_ENV !== 'production') return null;
  try { assertSessionConfiguration(); return null; }
  catch { return Response.json({ error: 'Private session service is unavailable.' }, { status: 503 }); }
}

export async function GET(request: NextRequest) {
  const settings = checkSessionSettings();
  if (settings) return settings;
  const session = readParticipantSession(request);
  return NextResponse.json(
    { authenticated: Boolean(session), profile_id: session?.profileId || null },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const settings = checkSessionSettings();
  if (settings) return settings;
  if (!originAllowed(request)) return Response.json({ error: 'Origin is not allowed.' }, { status: 403 });
  const previous = readParticipantSession(request);
  if (previous) {
    return Response.json({ status: 'ready', profile_id: previous.profileId }, { headers: { 'cache-control': 'no-store' } });
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
    const body: { user_id?: string; token?: string; profile_id?: string } = await response.json();
    const session = sealSession(body.user_id || '', body.token || '', body.profile_id || '');
    const result = NextResponse.json({ status: 'ready', profile_id: body.profile_id }, { headers: { 'cache-control': 'no-store' } });
    result.cookies.set(PARTICIPANT_COOKIE, session, sessionCookieOptions);
    return result;
  } catch {
    return Response.json({ error: 'Could not create your private voice profile. Please try again.' }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!originAllowed(request)) return Response.json({ error: 'Origin is not allowed.' }, { status: 403 });
  const settings = checkSessionSettings();
  if (settings) return settings;
  const previous = readParticipantSession(request);
  if (previous) {
    const base = process.env.SPEECH_API_URL;
    const key = process.env.SPEECH_API_TOKEN;
    if (!base || !key) return Response.json({ error: 'Cannot revoke session without the speech service.' }, { status: 503 });
    try {
      const result = await fetch(new URL('/v1/session/revoke', base), {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'x-sauti-user': previous.user,
          'x-sauti-user-token': previous.token,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(12000),
      });
      if (!result.ok) return Response.json({ error: 'Server sign out failed. Please retry.' },
        { status: 502, headers: { 'cache-control': 'no-store' } });
    } catch {
      return Response.json({ error: 'Server sign out failed. Please retry.' }, { status: 502 });
    }
  }
  const response = NextResponse.json({ status: 'signed_out' }, { headers: { 'cache-control': 'no-store' } });
  response.cookies.set(PARTICIPANT_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
