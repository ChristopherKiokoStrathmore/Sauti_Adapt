export async function GET() {
  // Does not disclose credentials or private profile details.
  const configured = Boolean(process.env.SPEECH_API_URL && process.env.SPEECH_API_TOKEN && process.env.DEMO_ACCESS_CODE);
  return Response.json({ frontend: 'ok', speech_api_configured: configured }, { headers: { 'cache-control': 'no-store' } });
}
