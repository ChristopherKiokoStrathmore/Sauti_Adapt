import type { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'A JSON instruction is required.' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return Response.json({ error: 'Invalid agent request.' }, { status: 422 });
  }
  const body = payload as Record<string, unknown>;
  if (typeof body.instruction !== 'string' || !body.instruction.trim()
      || body.instruction.length > 400
      || (body.page_url !== undefined && (typeof body.page_url !== 'string' || body.page_url.length > 2048))) {
    return Response.json({ error: 'Invalid agent instruction.' }, { status: 422 });
  }
  return proxyJson(request, '/v1/agent/plan', 'POST', {
    instruction: body.instruction,
    page_url: typeof body.page_url === 'string' ? body.page_url : '',
  });
}
