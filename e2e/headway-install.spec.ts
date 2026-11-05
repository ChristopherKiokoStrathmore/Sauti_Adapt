import { expect, test } from '@playwright/test';

const storeUrl = process.env.NEXT_PUBLIC_HEADWAY_CHROME_WEB_STORE_URL?.trim();

test('Chrome Web Store distribution remains a separate future path', async ({ page }) => {
  await page.goto('/install');
  await expect(page.getByRole('heading', { name: 'Meet Headway.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ready in four steps' })).toBeVisible();
  await expect(page.locator('a[href$=".zip"]')).toHaveCount(0);
  if (storeUrl) {
    await expect(page.getByRole('link', { name: 'Install Headway from Chrome Web Store' })).toHaveAttribute('href', storeUrl);
  } else {
    await expect(page.getByRole('status', { name: /approval pending/i })).toBeVisible();
  }
});

test('onboarding includes Headway from the beginning and launches a workspace at Step 5', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.topbar').getByRole('button', { name: /Enable Headway/i })).toBeVisible();
  await expect(page.getByText('Optional head control before voice onboarding')).toBeVisible();
  await page.locator('.stepper-card button').nth(4).click();
  const step = page.getByTestId('headway-install-step');
  await expect(step.getByRole('heading', { name: 'Your personalized experience' })).toBeVisible();
  await expect(step.getByRole('link', { name: /Launch My Accessible Workspace/ })).toHaveAttribute('href', '/workspace');
  await expect(step.getByText('No accepted command confirmed yet')).toBeVisible();
  await expect(step.getByText('Optional · Off')).toBeVisible();
  await expect(step.locator('a[href$=".zip"]')).toHaveCount(0);
  await step.getByRole('button', { name: /Back to recognition/ }).click();
  await expect(page.getByRole('heading', { name: 'Test with your voice' })).toBeVisible();
  await page.locator('.stepper-card button').nth(4).click();
  await step.getByRole('button', { name: 'Review setup' }).click();
  await expect(page.getByRole('heading', { name: 'Your preferences' })).toBeVisible();
});

test('the Step 5 workspace CTA is keyboard accessible on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('.stepper-card button').nth(4).click();
  const step = page.getByTestId('headway-install-step');
  const link = step.getByRole('link', { name: /Launch My Accessible Workspace/ });
  await link.focus();
  await expect(link).toBeFocused();
  const dims = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, inner: innerWidth }));
  expect(dims.width).toBeLessThanOrEqual(dims.inner + 1);
  await link.click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole('heading', { name: 'Explore your way.' })).toBeVisible();
});
