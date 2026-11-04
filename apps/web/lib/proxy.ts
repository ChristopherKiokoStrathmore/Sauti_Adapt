import type { NextRequest } from 'next/server';

/** Browser requests that send Origin must match an allowed host.
 *  A missing Origin is allowed: the Next.js server and other non-browser
 *  clients do not send one. Those callers still need a personal access token
 *  plus the separate server credential. Browsers attach Origin on cross-site
 *  requests, and a foreign Origin is rejected.
 */
export function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const configured = (process.env.SAUTI_ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean);
  if (configured.length > 0) return configured.includes(origin);
  const host = request.headers.get('host');
  try { return Boolean(host) && new URL(origin).host === host; } catch { return false; }
}

/** First hop of x-forwarded-for, otherwise x-real-ip. Empty when neither is present. */
export function forwardedClientIp(forwardedFor: string | null, realIp: string | null): string {
  const hop = (forwardedFor || '').split(',')[0].trim() || (realIp || '').trim();
  return hop.slice(0, 80);
}

export function userCredentials(request: NextRequest): { user: string; token: string } | null {
  const user = (request.headers.get('x-sauti-user') || '').trim();
  const token = request.headers.get('x-sauti-user-token') || '';
  if (!user || !token) return null;
  return { user, token };
}

export async function proxyForm(request: NextRequest, endpoint: '/v1/recognize' | '/v1/enroll' | '/v1/compare'): Promise<Response> {
  if (!originAllowed(request)) return Response.json({ error: 'Origin is not allowed.' }, { status: 403 });
  const creds = userCredentials(request);
  if (!creds) return Response.json({ error: 'Personal access token required.' }, { status: 401 });
  const base = process.env.SPEECH_API_URL;
  const token = process.env.SPEECH_API_TOKEN;
  if (!base || !token) return Response.json({ error: 'Speech backend not configured.' }, { status: 503 });
  const length = Number(request.headers.get('content-length') || '0');
  if (length > 2_500_000) return Response.json({ error: 'Audio upload too large.' }, { status: 413 });
  try {
    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size === 0 || audio.size > 2_000_000) {
      return Response.json({ error: 'A WAV recording smaller than 2 MB is required.' }, { status: 400 });
    }
    const clientIp = forwardedClientIp(request.headers.get('x-forwarded-for'), request.headers.get('x-real-ip'));
    const response = await fetch(new URL(endpoint, base), {
      method: 'POST',
      headers: {
        'x-api-key': token,
        'x-sauti-user': creds.user,
        'x-sauti-user-token': creds.token,
        ...(clientIp ? { 'x-sauti-client-ip': clientIp } : {}),
      },
      body: form,
      cache: 'no-store',
      signal: AbortSignal.timeout(endpoint === '/v1/compare' ? 180000 : 45000)
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  } catch {
    return Response.json({ error: 'Speech backend unavailable or request timed out.' }, { status: 502 });
  }
}
