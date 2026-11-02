import type { NextRequest } from 'next/server';

/** Browser requests must come from an allowed origin. Server-side calls omit Origin. */
export function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const configured = (process.env.SAUTI_ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean);
  if (configured.length > 0) return configured.includes(origin);
  const host = request.headers.get('host');
  try { return Boolean(host) && new URL(origin).host === host; } catch { return false; }
}

export function userCredentials(request: NextRequest): { user: string; token: string } | null {
  const user = (request.headers.get('x-sauti-user') || '').trim();
  const token = request.headers.get('x-sauti-user-token') || '';
  if (!user || !token) return null;
  return { user, token };
}

export async function proxyForm(request: NextRequest, endpoint: '/v1/recognize' | '/v1/enroll'): Promise<Response> {
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
    const response = await fetch(new URL(endpoint, base), {
      method: 'POST',
      headers: { 'x-api-key': token, 'x-sauti-user': creds.user, 'x-sauti-user-token': creds.token },
      body: form,
      cache: 'no-store',
      signal: AbortSignal.timeout(45000)
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  } catch {
    return Response.json({ error: 'Speech backend unavailable or request timed out.' }, { status: 502 });
  }
}
