import { expect, test } from '@playwright/test';

// The production site must not offer a fake install before Chrome Web Store review.
const storeUrl = process.env.NEXT_PUBLIC_HEADWAY_CHROME_WEB_STORE_URL?.trim();

test('Headway is offered through the Chrome Web Store after onboarding, never a ZIP', async ({ page }) => {
  await page.goto('/');
  const install = page.getByRole('link', { name: 'Install browser extension' });
  await expect(install).toHaveAttribute('href', '/install');
  await install.click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(page.getByRole('heading', { name: 'Meet Headway.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ready in four steps' })).toBeVisible();
  await expect(page.getByText('Add to Chrome', { exact: true })).toBeVisible();
  await expect(page.getByText('debugger permission', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: /Download Headway/ })).toHaveCount(0);
  await expect(page.locator('a[href$=".zip"]')).toHaveCount(0);

  if (storeUrl) {
    await expect(page.getByRole('link', { name: 'Install Headway from Chrome Web Store' })).toHaveAttribute('href', storeUrl);
  } else {
    await expect(page.getByRole('status', { name: /approval pending/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Install Headway from Chrome Web Store' })).toHaveCount(0);
  }
});

test('installation instructions remain usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/install');
  const sizes = await page.evaluate(() => {
    const button = document.querySelector('.install-primary')!.getBoundingClientRect();
    return { documentWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, buttonHeight: button.height };
  });
  expect(sizes.documentWidth).toBeLessThanOrEqual(sizes.innerWidth + 1);
  expect(sizes.buttonHeight).toBeGreaterThanOrEqual(54);
  await expect(page.getByRole('link', { name: /Return to voice onboarding/ })).toHaveAttribute('href', '/');
});

test('Step 5 guides genuine Chrome Web Store installation', async ({ page }) => {
  await page.goto('/');
  await page.locator('.stepper-card button').nth(4).click();
  const step = page.getByTestId('headway-install-step');
  await expect(step.getByRole('heading', { name: 'Install Headway extension' })).toBeVisible();
  if (storeUrl) {
    await expect(step.getByRole('link', { name: 'Install Headway from Chrome Web Store' })).toHaveAttribute('href', storeUrl);
  } else {
    await expect(step.getByRole('status', { name: /approval pending/i })).toBeVisible();
    await expect(step.getByRole('link', { name: 'Install Headway from Chrome Web Store' })).toHaveCount(0);
  }
  await expect(step.locator('a[href$=".zip"]')).toHaveCount(0);
  await expect(step.locator('.hi-preview-window')).toBeVisible();
  await expect(step.getByText('Website access', { exact: false })).toBeVisible();
  await expect(step.getByText('Camera access', { exact: false })).toBeVisible();
  await expect(step.getByText('Pointer control', { exact: false })).toBeVisible();
  await expect(step.getByText('Choose Add to Chrome.', { exact: false })).toBeHidden();
  await step.getByText('See installation guide').click();
  await expect(step.getByText('Choose Add to Chrome.', { exact: false })).toBeVisible();
  await expect(step.getByText('Open the listing.', { exact: false })).toBeVisible();
  await expect(step.getByRole('link', { name: /Open the full installation page/ })).toHaveAttribute('href', '/install');

  await step.getByRole('button', { name: 'Back to recognition' }).click();
  await expect(page.getByRole('heading', { name: 'Test with your voice' })).toBeVisible();
  await page.locator('.stepper-card button').nth(4).click();
  await step.getByRole('button', { name: 'Review setup' }).click();
  await expect(page.getByRole('heading', { name: 'Your preferences' })).toBeVisible();
});

test('Step 5 stays keyboard accessible and fits a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('.stepper-card button').nth(4).click();

  const step = page.getByTestId('headway-install-step');
  await expect(step.getByRole('heading', { name: 'Install Headway extension' })).toBeVisible();
  if (storeUrl) {
    const install = step.getByRole('link', { name: 'Install Headway from Chrome Web Store' });
    await install.focus();
    await expect(install).toBeFocused();
  } else {
    const guide = step.getByText('See installation guide');
    await guide.focus();
    await expect(guide).toBeFocused();
  }

  const metrics = await page.evaluate(() => {
    const cta = document.querySelector('.hi-download-button')!.getBoundingClientRect();
    return { windowWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, ctaHeight: cta.height, ctaWidth: cta.width };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.windowWidth + 1);
  expect(metrics.ctaHeight).toBeGreaterThanOrEqual(54);
  expect(metrics.ctaWidth).toBeGreaterThanOrEqual(200);
});
