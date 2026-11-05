export const runtime = 'nodejs';

export async function GET() {
  const base = process.env.SPEECH_API_URL;
  const token = process.env.SPEECH_API_TOKEN;
  if (!base || !token) {
    return Response.json({ online: false, mode: 'unavailable', enrollmentEnabled: false, comparisonEnabled: false, apiConfigured: false },
      { headers: { 'cache-control': 'no-store' } });
  }
  try {
    const [healthResponse, readinessResponse] = await Promise.all([
      fetch(new URL('/health', base), { cache: 'no-store', signal: AbortSignal.timeout(8000) }),
      fetch(new URL('/v1/readiness', base), {
        headers: { 'x-api-key': token }, cache: 'no-store', signal: AbortSignal.timeout(8000),
      }),
    ]);
    if (!healthResponse.ok) throw new Error('Speech service unavailable');
    const health = await healthResponse.json();
    const readiness = readinessResponse.ok ? await readinessResponse.json() : {};
    // Public dashboard deliberately exposes coarse operational status only.
    // Never return authentication settings, account lists, infrastructure paths or voice data.
    return Response.json({
      online: health.status === 'ok',
      mode: typeof health.mode === 'string' ? health.mode : 'unknown',
      enrollmentEnabled: health.enrollment_enabled === true,
      comparisonEnabled: readiness.comparison_enabled === true,
      apiConfigured: true,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({
      online: false, mode: 'unavailable', enrollmentEnabled: false,
      comparisonEnabled: false, apiConfigured: true,
    }, { headers: { 'cache-control': 'no-store' } });
  }
}
