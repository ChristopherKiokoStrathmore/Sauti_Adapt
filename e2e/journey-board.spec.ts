import { expect, test, type Page } from '@playwright/test';

async function startOnboarding(page: Page, journey: 'a' | 'b' | 'c') {
  await page.goto('/?journey=' + journey);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-journey', journey);
  await expect(page.getByRole('heading', { name: /Your voice.*Your way/i, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Get started/ }).click();
  await expect(page.getByRole('heading', { name: 'Your preferences' })).toBeVisible();
}

async function registerAdult(page: Page, journey: 'a' | 'b' | 'c') {
  await startOnboarding(page, journey);
  await page.getByRole('button', { name: /Save and continue/ }).click();
  await page.locator('#participant-name').fill('Journey test volunteer');
  await page.locator('#participant-age').fill('24');
  await page.locator('.permission-card input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: /Continue to voice samples/ }).click();
  await expect(page.getByRole('heading', { name: 'Teach Sauti your voice' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('private voice profile is ready');
}

async function microphone(page: Page) {
  await page.evaluate(async () => {
    const audio = new AudioContext();
    await audio.resume();
    navigator.mediaDevices.getUserMedia = async () => {
      const output = audio.createMediaStreamDestination();
      const oscillator = audio.createOscillator();
      oscillator.connect(output);
      oscillator.start();
      return output.stream;
    };
  });
}

async function recordOnce(page: Page) {
  await page.getByRole('button', { name: 'Start voice recording' }).click();
  await expect(page.getByRole('button', { name: /Stop recording/ })).toBeEnabled();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Stop recording/ }).click();
  if (await page.locator('.app-shell').getAttribute('data-journey') === 'c') {
    await expect(page.getByRole('status')).toContainText('Voice sample saved privately');
    await expect(page.getByRole('button', { name: /Save voice sample/ })).toHaveCount(0);
  } else {
    await expect(page.getByRole('button', { name: /Save voice sample/ })).toBeEnabled();
  }
}

test('A baseline exposes full preference and extension information for comparison', async ({ page }) => {
  await startOnboarding(page, 'a');
  await expect(page.getByRole('group', { name: 'Commands to practise' })).toBeVisible();
  await expect(page.locator('#listen')).toBeVisible();
  await page.locator('.stepper-card button').nth(3).click();
  await expect(page.getByRole('heading', { name: 'Check recognition' })).toBeVisible();
  await page.getByRole('button', { name: /Continue to extension/ }).click();
  await expect(page.getByRole('link', { name: /Download and install Headway/ })).toHaveAttribute('href', '/install');
});

test('A versus B simplifies preference decisions while keeping language and accessibility options', async ({ page }) => {
  await startOnboarding(page, 'b');
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kiswahili' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Commands to practise' })).toBeHidden();
  await expect(page.locator('#listen')).toBeHidden();
  await page.getByText('Recording accessibility options').click();
  await expect(page.locator('#listen')).toBeVisible();
  await page.locator('#maxsec').selectOption('8');
  await page.getByRole('button', { name: /Save and continue/ }).click();
  await expect(page.getByRole('heading', { name: /About you and your permission/ })).toBeVisible();
});

test('B versus C uses one task at a time, adjustable pace and honest readiness', async ({ page }) => {
  await registerAdult(page, 'c');
  await expect(page.getByText('Speak naturally. There is no need', { exact: false })).toBeVisible();
  await page.getByText('Need more speaking time or a different recording button?').click();
  await page.locator('#clip-pace').selectOption('15');
  await page.locator('#record-style').selectOption('separate');
  await expect(page.locator('#clip-pace')).toHaveValue('15');
  await expect(page.getByRole('button', { name: /Stop recording/ })).toBeDisabled();
  await microphone(page);
  await recordOnce(page);
  await page.getByRole('button', { name: /Record another example/ }).click();
  await expect(page.getByText('Example 2 of 3')).toBeVisible();
  await recordOnce(page);
  await expect(page.getByRole('status')).toContainText('Voice sample saved privately');
  await expect(page.getByText('More about training progress')).toBeVisible();
  await expect(page.getByText('All three sessions are complete.')).toBeHidden();
  await page.locator('.stepper-card button').nth(3).click();
  await expect(page.getByText('Training and validation must finish', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Optional demo without speaking' })).toBeVisible();
  await page.getByRole('button', { name: 'bigger text' }).click();
  await expect(page.getByRole('status')).toHaveText('Making text bigger.');
  await page.getByRole('button', { name: /Finish this journey/ }).click();
  await expect(page.getByText('Your Sauti voice profile is separate and remains private.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Download and install Headway/ })).toHaveAttribute('href', '/install');
  await expect(page.getByText('Build and load the extension', { exact: false })).toBeHidden();
});

test('inaccessible microphone shows feedback and never creates an unsaved clip', async ({ page }) => {
  await registerAdult(page, 'c');
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permission denied for microphone', 'NotAllowedError');
    };
  });
  await page.getByRole('button', { name: /Start voice recording/ }).click();
  await expect(page.getByRole('status')).toContainText('Microphone access is blocked');
  await expect(page.locator('.sample-dots')).toHaveAttribute('aria-label', '0 of 3 saved');
});

test('consent, optional diagnosis, age restriction and deletion controls remain private and available', async ({ page, request }) => {
  await startOnboarding(page, 'c');
  await page.getByRole('button', { name: /Save and continue/ }).click();
  await page.locator('#participant-name').fill('Consent check');
  await page.locator('#participant-age').fill('12');
  await expect(page.getByText('requires verified parent or guardian consent', { exact: false })).toBeVisible();
  const forbidden = await request.post('/api/participant', { data: { age: 12, consent: true, termsVersion: '2026-11-v1' } });
  expect(forbidden.status()).toBe(403);
  await page.locator('#participant-age').fill('23');
  await page.locator('#speech-condition').selectOption('prefer-not-to-say');
  await expect(page.getByRole('button', { name: /Continue to voice samples/ })).toBeDisabled();
  await page.locator('.permission-card input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: /Continue to voice samples/ }).click();
  const profileId = await page.locator('#profile').inputValue();
  await page.getByText('My voice and privacy').click();
  await expect(page.getByRole('button', { name: /Delete my voice data/ })).toBeDisabled();
  await page.getByText('Confirm profile deletion').click();
  await page.getByRole('button', { name: /Delete my voice data/ }).click();
  await expect(page.getByRole('status')).toContainText(/Deleted|No stored recordings/);
  const audit = await page.request.get('/api/participant');
  expect((await audit.json()).profile_id).toBe(profileId);
});

test('C variant respects keyboard access, reduced motion and mobile target dimensions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startOnboarding(page, 'c');
  await page.getByRole('button', { name: /Save and continue/ }).focus();
  await expect(page.getByRole('button', { name: /Save and continue/ })).toBeFocused();
  const m = await page.evaluate(() => {
    const start = document.querySelector('.hero-primary-action')?.getBoundingClientRect();
    const primary = document.querySelector('.card-actions button')?.getBoundingClientRect();
    const style = getComputedStyle(document.querySelector('.hero-primary-action') as Element);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      windowWidth: innerWidth,
      heroHeight: start?.height ?? 0,
      primaryHeight: primary?.height ?? 0,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(m.scrollWidth).toBeLessThanOrEqual(m.windowWidth + 1);
  expect(m.heroHeight).toBeGreaterThanOrEqual(54);
  expect(m.primaryHeight).toBeGreaterThanOrEqual(54);
  expect(m.transitionDuration).toBe('0s');
});

test('public research screen remains separate and does not reveal participant records', async ({ page, request }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Speech model laboratory' })).toBeVisible();
  const status = await (await request.get('/api/admin/status')).json();
  expect(Object.keys(status).sort()).toEqual(['apiConfigured', 'comparisonEnabled', 'enrollmentEnabled', 'mode', 'online']);
  expect(JSON.stringify(status)).not.toMatch(/participant_accounts|private_key|user_token/i);
});
