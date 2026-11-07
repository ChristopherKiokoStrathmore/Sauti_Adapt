import type { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/proxy';
export const runtime = 'nodejs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let body: { profile_id?: unknown } = {};
  try { body = await request.json(); } catch { /* handled below */ }
  if (typeof body.profile_id !== 'string' || !UUID.test(body.profile_id)) {
    return Response.json({ error: 'A valid profile_id is required.' }, { status: 400 });
  }
  return proxyJson(request, '/v1/train', 'POST', { profile_id: body.profile_id });
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('profile_id') || '';
  if (!UUID.test(id)) return Response.json({ error: 'A valid profile_id is required.' }, { status: 400 });
  return proxyJson(request, '/v1/train/' + id, 'GET');
}
