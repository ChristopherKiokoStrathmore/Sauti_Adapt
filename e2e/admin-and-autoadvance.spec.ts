import { expect, test } from '@playwright/test';

test('research dashboard is public and never returns credentials or participant records', async ({ page, request }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Speech model laboratory' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compare speech models' })).toBeVisible();
  await expect(page.getByText('This page is public.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start model comparison/ })).toBeDisabled();
  const response = await request.get('/api/admin/status');
  expect(response.status()).toBe(200);
  const status = await response.json();
  expect(Object.keys(status).sort()).toEqual(['apiConfigured', 'comparisonEnabled', 'enrollmentEnabled', 'mode', 'online']);
  expect(JSON.stringify(status)).not.toContain('test-secret');
  expect(JSON.stringify(status)).not.toContain('participant_accounts');
});

test('saving the third command example advances to recognition automatically', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Save and continue/ }).click();
  await page.locator('#participant-name').fill('Automatic progression test');
  await page.locator('#participant-age').fill('24');
  await page.locator('.permission-card input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: /Continue to voice samples/ }).click();
  await expect(page.getByRole('heading', { name: 'Teach Sauti your voice' })).toBeVisible();
  // Keep the Stop control mounted through React state transitions on every attempt.
  await page.getByRole('button', { name: /Your preferences/ }).click();
  await page.getByText('Recording accessibility options').click();
  await page.locator('#listen').selectOption('separate');
  await page.getByRole('button', { name: /Voice samples/ }).click();
  await page.evaluate(async () => {
    const audio = new AudioContext();
    await audio.resume();
    // Each recording ends its media tracks. Return a fresh stream for each sample.
    navigator.mediaDevices.getUserMedia = async () => {
      const output = audio.createMediaStreamDestination();
      const oscillator = audio.createOscillator();
      oscillator.connect(output);
      oscillator.start();
      return output.stream;
    };
  });
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Start voice recording' }).click();
    await expect(page.getByRole('button', { name: /Stop recording/ })).toBeEnabled();
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: /Stop recording/ }).click();
    await expect(page.getByRole('button', { name: /Save voice sample/ })).toBeEnabled();
    await page.getByRole('button', { name: /Save voice sample/ }).click();
    if (i < 2) {
      await expect(page.getByRole('status')).toContainText('Voice sample saved privately');
    }
  }
  await expect(page.getByRole('heading', { name: 'Check recognition' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('All three voice examples');
  await expect(page.getByText('Compare recognition models')).toHaveCount(0);
});
