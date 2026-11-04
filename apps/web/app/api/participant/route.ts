import { type NextRequest } from 'next/server';
import { originAllowed, forwardedClientIp } from '../../../lib/proxy';

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return Response.json({ error: 'Origin is not allowed.' }, { status: 403 });
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
      headers: { 'x-api-key': secret, ...(ip ? { 'x-sauti-client-ip': ip } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ error: 'Could not create your private voice profile. Please try again.' }, { status: 502 });
  }
}
