import { expect, test } from '@playwright/test';

test('participant experience uses clear, accessible cinematic hierarchy on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your voice.*Your way/i, level: 1 })).toBeVisible();
  await expect(page.locator('.intro-visual')).toBeVisible();
  await expect(page.locator('.stepper-intro')).toContainText('STEP 1 OF 5');
  await expect(page.getByRole('button', { name: /Save and continue/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Hear this step/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sauti Adapt home' })).toBeVisible();

  const metrics = await page.evaluate(() => ({
    screenWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    buttonHeight: document.querySelector('.card-actions button')?.getBoundingClientRect().height ?? 0,
    visualHiddenFromSpeech: document.querySelector('.intro-visual')?.getAttribute('aria-hidden'),
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.screenWidth + 1);
  expect(metrics.buttonHeight).toBeGreaterThanOrEqual(54);
  expect(metrics.visualHiddenFromSpeech).toBe('true');
});

test('technical training details are optional and the research dashboard is visually separate', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Save and continue/ }).click();
  await expect(page.locator('.stepper-intro')).toContainText('STEP 2 OF 5');
  await expect(page.getByRole('heading', { name: /About you and your permission/ })).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Speech model laboratory' })).toBeVisible();
  await expect(page.locator('.admin-hero-art')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Participant experience' })).toBeVisible();
  await expect(page.getByText('This page is public.', { exact: false })).toBeVisible();
});
