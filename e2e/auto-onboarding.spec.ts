import { expect, test } from '@playwright/test';

test('new adult participant can enroll, review a clip, save and return securely', async ({ page }) => {
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
  expect(await participant.json()).toEqual({ authenticated: true });
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
  await expect(page.getByRole('status')).toContainText('Nothing has been uploaded');
  await expect(page.getByRole('button', { name: /Save voice sample/ })).toBeEnabled();
  await page.getByRole('button', { name: /Save voice sample/ }).click();
  await expect(page.getByRole('status')).toContainText('Voice sample saved privately');

  await page.reload();
  const afterRefresh = await page.request.get('/api/participant');
  expect(await afterRefresh.json()).toEqual({ authenticated: true });

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
  expect(await session.json()).toEqual({ authenticated: false });
});
