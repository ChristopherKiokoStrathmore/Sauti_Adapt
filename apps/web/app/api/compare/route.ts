import type { NextRequest } from 'next/server';
import { proxyForm } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return proxyForm(request, '/v1/compare');
}
