import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

function matchesSecret(provided: string, actual: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Hackathon-only access control. Replace with per-user authentication before public release. */
export function authorize(request: NextRequest): boolean {
  const secret = process.env.DEMO_ACCESS_CODE;
  return !!secret && matchesSecret(request.headers.get('x-sauti-demo-code') || '', secret);
}

export async function proxyForm(request: NextRequest, endpoint: '/v1/recognize' | '/v1/enroll'): Promise<Response> {
  if (!authorize(request)) return Response.json({ error: 'Access code invalid or not configured.' }, { status: 401 });
  const base = process.env.SPEECH_API_URL;
  const token = process.env.SPEECH_API_TOKEN;
  if (!base || !token) return Response.json({ error: 'Speech backend not configured.' }, { status: 503 });
  const length = Number(request.headers.get('content-length') || '0');
  if (length > 3_000_000) return Response.json({ error: 'Audio upload too large.' }, { status: 413 });
  try {
    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size === 0 || audio.size > 2_000_000) {
      return Response.json({ error: 'A WAV recording smaller than 2 MB is required.' }, { status: 400 });
    }
    const response = await fetch(new URL(endpoint, base), {
      method: 'POST',
      headers: { 'x-api-key': token },
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
