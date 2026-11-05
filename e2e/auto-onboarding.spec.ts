import { expect, test } from '@playwright/test';

test('Path C participant can enroll, automatically save a clip, and return securely', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Save and continue/ }).click();
  await page.locator('#participant-name').fill('Browser test participant');
  await page.locator('#participant-age').fill('24');
  await page.locator('.permission-card input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: /Continue to voice samples/ }).click();

  await expect(page.getByRole('heading', { name: 'Teach Sauti your voice' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('private voice profile is ready');

  const participant = await page.request.get('/api/participant');
  expect(participant.ok()).toBeTruthy();
  const participantDetails = await participant.json();
  expect(participantDetails.authenticated).toBe(true);
  expect(participantDetails.profile_id).toMatch(/^[0-9a-f-]{36}$/);
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find(cookie => cookie.name === 'sauti-voice-session');
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.value).toBeTruthy();

  const profileId = await page.locator('#profile').inputValue();
  await page.evaluate(async () => {
    const audio = new AudioContext();
    await audio.resume();
    const output = audio.createMediaStreamDestination();
    const oscillator = audio.createOscillator();
    oscillator.connect(output);
    oscillator.start();
    navigator.mediaDevices.getUserMedia = async () => output.stream;
  });
  await page.getByRole('button', { name: 'Start voice recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeEnabled();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  // Path C autosaves after the explicit recording consent; no extra Save click.
  await expect(page.getByRole('status')).toContainText('Voice sample saved privately');
  await expect(page.getByRole('button', { name: /Save voice sample/ })).toHaveCount(0);
  await expect(page.getByText('Example 2 of 3')).toBeVisible();

  await page.reload();
  const afterRefresh = await page.request.get('/api/participant');
  expect(await afterRefresh.json()).toMatchObject({ authenticated: true, profile_id: profileId });

  const deletion = await page.request.delete('/api/profile?profile_id=' + encodeURIComponent(profileId));
  expect(deletion.status()).toBe(200);
  expect((await deletion.json()).deleted).toBe(true);
});

test('a child cannot obtain a recording account using their stated age', async ({ request }) => {
  const response = await request.post('/api/participant', {
    data: { age: 12, consent: true, termsVersion: '2026-11-v1' },
  });
  expect(response.status()).toBe(403);
  const session = await request.get('/api/participant');
  expect(await session.json()).toEqual({ authenticated: false, profile_id: null });
});
