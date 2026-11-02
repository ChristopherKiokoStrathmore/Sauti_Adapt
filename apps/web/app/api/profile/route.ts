import type { NextRequest } from 'next/server';
import { forwardedClientIp, originAllowed, userCredentials } from '@/lib/proxy';

export const runtime = 'nodejs';

function target(profileId: string, recordingId: string | null): URL | Response {
  const base = process.env.SPEECH_API_URL;
  const token = process.env.SPEECH_API_TOKEN;
  if (!base || !token) return Response.json({ error: 'Speech backend not configured.' }, { status: 503 });
  if (!/^[0-9a-fA-F-]{36}$/.test(profileId)) return Response.json({ error: 'A profile UUID is required.' }, { status: 422 });
  const path = recordingId
    ? `/v1/profile/${profileId}/recordings/${recordingId}`
    : `/v1/profile/${profileId}`;
  if (recordingId && !/^[0-9a-fA-F-]{36}$/.test(recordingId)) {
    return Response.json({ error: 'A recording UUID is required.' }, { status: 422 });
  }
  return new URL(path, base);
}

export async function DELETE(request: NextRequest) {
  if (!originAllowed(request)) return Response.json({ error: 'Origin is not allowed.' }, { status: 403 });
  const creds = userCredentials(request);
  if (!creds) return Response.json({ error: 'Personal access token required.' }, { status: 401 });
  const profileId = request.nextUrl.searchParams.get('profile_id') || '';
  const recordingId = request.nextUrl.searchParams.get('recording_id');
  const url = target(profileId, recordingId);
  if (url instanceof Response) return url;
  const token = process.env.SPEECH_API_TOKEN as string;
  try {
    const clientIp = forwardedClientIp(request.headers.get('x-forwarded-for'), request.headers.get('x-real-ip'));
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'x-api-key': token,
        'x-sauti-user': creds.user,
        'x-sauti-user-token': creds.token,
        ...(clientIp ? { 'x-sauti-client-ip': clientIp } : {}),
      },
      cache: 'no-store',
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ error: 'Speech backend unavailable.' }, { status: 502 });
  }
}
