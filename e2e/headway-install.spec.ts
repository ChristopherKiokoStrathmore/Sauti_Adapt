import { expect, test } from '@playwright/test';

test('Headway is the extension offered after onboarding, without requiring speech recognition', async ({ page }) => {
  await page.goto('/');
  const install = page.getByRole('link', { name: 'Install browser extension' });
  await expect(install).toHaveAttribute('href', '/install');
  await install.click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(page.getByRole('heading', { name: 'Meet Headway.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ready in four steps' })).toBeVisible();
  const download = page.getByRole('link', { name: 'Download Headway Chrome extension ZIP' });
  await expect(download).toHaveAttribute(
    'href',
    'https://github.com/ChristopherKiokoStrathmore/Sauti_Adapt/releases/download/headway-hackathon/Headway-Chrome-Hackathon.zip',
  );
  await expect(page.getByText('chrome://extensions', { exact: true })).toBeVisible();
  await expect(page.getByText('Load unpacked', { exact: true })).toBeVisible();
  await expect(page.getByText('debugger permission', { exact: false })).toBeVisible();
});

test('Headway installation instructions are usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/install');
  const sizes = await page.evaluate(() => {
    const button = document.querySelector('.install-primary')!.getBoundingClientRect();
    return { documentWidth: document.documentElement.scrollWidth, innerWidth, buttonHeight: button.height };
  });
  expect(sizes.documentWidth).toBeLessThanOrEqual(sizes.innerWidth + 1);
  expect(sizes.buttonHeight).toBeGreaterThanOrEqual(54);
  await expect(page.getByRole('link', { name: /Return to voice onboarding/ })).toHaveAttribute('href', '/');
});

test('onboarding Step 5 renders the approved Headway download journey directly', async ({ page }) => {
  await page.goto('/');
  await page.locator('.stepper-card button').nth(4).click();
  const step = page.getByTestId('headway-install-step');
  await expect(step.getByRole('heading', { name: 'Install Headway extension' })).toBeVisible();
  await expect(step.getByRole('link', { name: 'Download Headway Chrome extension ZIP' }))
    .toHaveAttribute('href', 'https://github.com/ChristopherKiokoStrathmore/Sauti_Adapt/releases/download/headway-hackathon/Headway-Chrome-Hackathon.zip');

  await expect(step.locator('.hi-preview-window')).toBeVisible();
  await expect(step.getByText('Website access', { exact: false })).toBeVisible();
  await expect(step.getByText('Camera access', { exact: false })).toBeVisible();
  await expect(step.getByText('Pointer control', { exact: false })).toBeVisible();

  await expect(step.getByText('chrome://extensions', { exact: true })).toBeHidden();
  await step.getByText('See installation guide').click();
  await expect(step.getByText('chrome://extensions', { exact: true })).toBeVisible();
  await expect(step.getByText('Select Load unpacked.', { exact: true })).toBeVisible();
  await step.getByRole('button', { name: 'Copy Chrome extensions address' }).click();
  await expect(step.getByRole('status')).toContainText(/Address copied|Copy unavailable/);
  await expect(step.getByRole('link', { name: /Open the full installation page/ }))
    .toHaveAttribute('href', '/install');

  await step.getByRole('button', { name: 'Back to recognition' }).click();
  await expect(page.getByRole('heading', { name: 'Test with your voice' })).toBeVisible();
  await page.locator('.stepper-card button').nth(4).click();
  await step.getByRole('button', { name: 'Review setup' }).click();
  await expect(page.getByRole('heading', { name: 'Your preferences' })).toBeVisible();
});

test('Step 5 remains keyboard accessible and fits a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('.stepper-card button').nth(4).click();

  const step = page.getByTestId('headway-install-step');
  await expect(step.getByRole('heading', { name: 'Install Headway extension' })).toBeVisible();
  const download = step.getByRole('link', { name: 'Download Headway Chrome extension ZIP' });
  await download.focus();
  await expect(download).toBeFocused();

  const metrics = await page.evaluate(() => {
    const cta = document.querySelector('.hi-download-button')!.getBoundingClientRect();
    return {
      windowWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      downloadHeight: cta.height,
      downloadWidth: cta.width,
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.windowWidth + 1);
  expect(metrics.downloadHeight).toBeGreaterThanOrEqual(54);
  expect(metrics.downloadWidth).toBeGreaterThanOrEqual(200);
});
