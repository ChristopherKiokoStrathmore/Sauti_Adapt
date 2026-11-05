import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const cloudURL = process.env.SAUTI_LIVE_WEB_URL || '';
const user = process.env.SAUTI_LIVE_USER_ID || '';
const token = process.env.SAUTI_LIVE_USER_TOKEN || '';
const allowMutation = process.env.SAUTI_LIVE_MUTATION_OK === 'YES_DISPOSABLE_ACCOUNT';

function testAudio(): Buffer {
  // Synthetic test tone: proves upload plumbing, NOT participant speech accuracy.
  const n = 16000;
  const buffer = Buffer.alloc(44 + n * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + n * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 270 * i / 16000) * 4000), 44 + i * 2);
  }
  return buffer;
}

test('hosted onboarding and proxy configuration are available', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /set up sauti/i })).toBeVisible();
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({
    frontend: 'ok',
    speech_api_configured: true,
  });
});

test('the public speech service is in real prototype enrollment mode', async ({ request }) => {
  test.skip(!process.env.SAUTI_LIVE_SPEECH_URL, 'Supply SAUTI_LIVE_SPEECH_URL for service health check.');
  const api = new URL(process.env.SAUTI_LIVE_SPEECH_URL!);
  expect(api.protocol).toBe('https:');
  const response = await request.get(new URL('/health', api).toString());
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({
    status: 'ok',
    mode: 'prototype',
    enrollment_enabled: true,
  });
});

test('consented disposable upload succeeds and owner can delete it', async ({ request }) => {
  test.skip(!allowMutation, 'Explicit SAUTI_LIVE_MUTATION_OK opt-in is required.');
  test.skip(!user || !token, 'Dedicated disposable user credentials are required.');

  const profile = randomUUID();
  const headers = { 'x-sauti-user': user, 'x-sauti-user-token': token };
  let created = false;
  try {
    const enrolled = await request.post('/api/enroll', {
      headers,
      multipart: {
        audio: { name: 'synthetic-test.wav', mimeType: 'audio/wav', buffer: testAudio() },
        profile_id: profile, session_id: randomUUID(),
        language: 'en-KE', intent: 'SCROLL_DOWN',
        consent: 'true', terms_version: '2026-11-v1',
        session_role: 'train', tone: 'calm', retention_days: '1',
      },
    });
    expect(enrolled.ok(), await enrolled.text()).toBeTruthy();
    created = true;
    expect(await enrolled.json()).toMatchObject({ status: 'stored', profile_id: profile });
  } finally {
    // Delete only the disposable UUID created in this test.
    if (created) {
      const deleted = await request.delete('/api/profile?profile_id=' + encodeURIComponent(profile), { headers });
      expect(deleted.ok()).toBeTruthy();
    }
  }
});
