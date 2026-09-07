import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';

const HCAPTCHA_SITE_KEY = '10000000-ffff-ffff-ffff-000000000001';
const HCAPTCHA_TEST_SECRET = `0x${'0'.repeat(40)}`;
const CAPTCHA_REQUIRED_MESSAGE = 'Please complete the CAPTCHA verification.';
const CAPTCHA_INVALID_MESSAGE = 'CAPTCHA configuration is incomplete. Please contact an administrator.';

type CaptchaConfigUpdate = {
  enabled: boolean;
  provider: 'none' | 'hcaptcha';
  hcaptchaSiteKey: string;
  hcaptchaSecretKey: string;
  recaptchaSiteKey: string;
  recaptchaSecretKey: string;
};

const DISABLED_CAPTCHA: CaptchaConfigUpdate = {
  enabled: false,
  provider: 'none',
  hcaptchaSiteKey: '',
  hcaptchaSecretKey: '',
  recaptchaSiteKey: '',
  recaptchaSecretKey: '',
};

const INVALID_CAPTCHA: CaptchaConfigUpdate = {
  ...DISABLED_CAPTCHA,
  enabled: true,
};

const VALID_HCAPTCHA: CaptchaConfigUpdate = {
  ...DISABLED_CAPTCHA,
  enabled: true,
  provider: 'hcaptcha',
  hcaptchaSiteKey: HCAPTCHA_SITE_KEY,
  hcaptchaSecretKey: HCAPTCHA_TEST_SECRET,
};

async function setCaptchaConfig(
  request: import('@playwright/test').APIRequestContext,
  config: CaptchaConfigUpdate,
): Promise<void> {
  const response = await request.put('/api/v1/settings/captcha', { data: config });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function prepareCaptchaLogin(
  request: import('@playwright/test').APIRequestContext,
  config: CaptchaConfigUpdate,
): Promise<void> {
  await loginAsInitialAdmin(request);
  const settingsResponse = await request.put('/api/v1/settings', {
    data: { language: 'en-US', timezone: 'UTC' },
  });
  expect(settingsResponse.ok(), await settingsResponse.text()).toBeTruthy();
  await setCaptchaConfig(request, config);
}

async function restoreCaptcha(request: import('@playwright/test').APIRequestContext): Promise<void> {
  await setCaptchaConfig(request, DISABLED_CAPTCHA);
}

async function loadLoginWithCaptcha(
  page: import('@playwright/test').Page,
  expectedConfig: { enabled: boolean; provider: string },
): Promise<void> {
  const captchaResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/settings/captcha') && response.request().method() === 'GET',
  );
  await page.goto('/login');
  const captchaResponse = await captchaResponsePromise;
  expect(captchaResponse.ok()).toBeTruthy();
  await expect(captchaResponse.json()).resolves.toMatchObject(expectedConfig);
}

async function completeHcaptchaTestWidget(page: import('@playwright/test').Page): Promise<void> {
  const checkboxFrame = page.frameLocator('iframe[title*="hCaptcha security challenge"]');
  await checkboxFrame.locator('#checkbox').click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const api = (window as Window & { hcaptcha?: { getResponse: () => string } }).hcaptcha;
          return api?.getResponse?.() ?? '';
        }),
      { timeout: 20_000 },
    )
    .not.toBe('');
}

async function recordCaptchaMetrics(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  filename: string,
): Promise<void> {
  const metrics = await page.evaluate(() => {
    const describe = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        style: {
          display: style.display,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          color: style.color,
          backgroundColor: style.backgroundColor,
          marginTop: style.marginTop,
          marginBottom: style.marginBottom,
        },
        text: element.textContent?.trim() ?? '',
      };
    };
    const submit = document.querySelector<HTMLButtonElement>('form button[type="submit"]');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      page: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      },
      elements: {
        username: describe(document.querySelector('#username')),
        password: describe(document.querySelector('#password')),
        alert: describe(document.querySelector('[role="alert"]')),
        submit: describe(submit),
      },
      submit: submit
        ? {
            disabled: submit.disabled,
            text: submit.textContent?.trim() ?? '',
          }
        : null,
      statusText: [...document.querySelectorAll('[role="status"]')]
        .map((element) => element.textContent?.trim() ?? '')
        .filter(Boolean),
      alertText: [...document.querySelectorAll('[role="alert"]')]
        .map((element) => element.textContent?.trim() ?? '')
        .filter(Boolean),
    };
  });
  const metricsPath = testInfo.outputPath(filename);
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
  await testInfo.attach(filename, { path: metricsPath, contentType: 'application/json' });
  expect(metrics.page.scrollWidth).toBeLessThanOrEqual(metrics.page.clientWidth);
}

test('login CAPTCHA fails closed for invalid configuration', async ({ page, request }, testInfo) => {
  await prepareCaptchaLogin(request, INVALID_CAPTCHA);

  try {
    await step('load the login page with the real invalid CAPTCHA configuration', async () => {
      await loadLoginWithCaptcha(page, { enabled: true, provider: 'none' });
      await expect(page.getByRole('heading', { name: 'User Login', exact: true })).toBeVisible();
      await expect(page.getByText(CAPTCHA_INVALID_MESSAGE, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeDisabled();
    });

    await step('do not send first-factor credentials while CAPTCHA configuration is invalid', async () => {
      await page.locator('#username').fill(E2E_ADMIN.username);
      await page.locator('#password').fill(E2E_ADMIN.password);
      const loginRequest = page
        .waitForRequest((request) => request.url().endsWith('/api/v1/auth/login') && request.method() === 'POST', {
          timeout: 2_000,
        })
        .catch(() => undefined);
      await page
        .getByRole('button', { name: 'Login', exact: true })
        .click({ force: true })
        .catch(() => undefined);
      expect(await loginRequest).toBeUndefined();
      await expect(page.getByText(CAPTCHA_INVALID_MESSAGE, { exact: true })).toHaveCount(1);
      await captureFunctionalScreenshot(page, 'm01-login-captcha-invalid-config.png', {
        viewport: { width: 1440, height: 900 },
      });
      await recordCaptchaMetrics(page, testInfo, 'login-captcha-invalid-config.metrics.json');
    });
  } finally {
    await restoreCaptcha(request);
  }
});

test('login CAPTCHA requires a token before sending first-factor credentials', async ({ page, request }, testInfo) => {
  await prepareCaptchaLogin(request, VALID_HCAPTCHA);

  try {
    await step('load the login page with the real valid hCaptcha configuration', async () => {
      await loadLoginWithCaptcha(page, { enabled: true, provider: 'hcaptcha' });
      await expect(page.getByRole('heading', { name: 'User Login', exact: true })).toBeVisible();
      await expect(page.getByText('Please complete the verification below:', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeEnabled();
    });

    await step('block a no-token first-factor submit without contacting the auth endpoint', async () => {
      await page.locator('#username').fill(E2E_ADMIN.username);
      await page.locator('#password').fill(E2E_ADMIN.password);
      const loginRequest = page
        .waitForRequest((request) => request.url().endsWith('/api/v1/auth/login') && request.method() === 'POST', {
          timeout: 2_000,
        })
        .catch(() => undefined);
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      expect(await loginRequest).toBeUndefined();
      await expect(page.getByRole('alert')).toHaveCount(1);
      await expect(page.getByRole('alert')).toHaveText(CAPTCHA_REQUIRED_MESSAGE);
      await expect(page.getByText('Login failed. Please try again.', { exact: true })).toHaveCount(0);
      await captureFunctionalScreenshot(page, 'm01-login-captcha-required.png', {
        viewport: { width: 1440, height: 900 },
      });
      await recordCaptchaMetrics(page, testInfo, 'login-captcha-required.metrics.json');
    });
  } finally {
    await restoreCaptcha(request);
  }
});

test('login CAPTCHA clears expired/rejected verification and succeeds after a fresh real token', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  await prepareCaptchaLogin(request, VALID_HCAPTCHA);

  const evidence: Array<Record<string, unknown>> = [];
  try {
    await step('obtain a real hCaptcha test token and let the provider expire it', async () => {
      await loadLoginWithCaptcha(page, { enabled: true, provider: 'hcaptcha' });
      await page.locator('#username').fill(E2E_ADMIN.username);
      await page.locator('#password').fill(E2E_ADMIN.password);
      await completeHcaptchaTestWidget(page);

      // hCaptcha documents a 120 second default token expiry. Wait for the real
      // provider callback instead of shortening time or mutating application state.
      await page.waitForTimeout(125_000);

      const loginRequest = page
        .waitForRequest(
          (candidate) => candidate.url().endsWith('/api/v1/auth/login') && candidate.method() === 'POST',
          {
            timeout: 2_000,
          },
        )
        .catch(() => undefined);
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      expect(await loginRequest).toBeUndefined();
      await expect(page.getByRole('alert')).toHaveText(CAPTCHA_REQUIRED_MESSAGE);
      evidence.push({ phase: 'provider-expired', loginRequestSent: false, alert: CAPTCHA_REQUIRED_MESSAGE });
    });

    await step('a real provider rejection resets the Login CAPTCHA token', async () => {
      await completeHcaptchaTestWidget(page);

      // Change only the server-side fixture secret after the browser received a
      // valid token. The Login submission still comes from the real UI and the
      // backend still calls hCaptcha siteverify; the provider rejects the pair.
      await setCaptchaConfig(request, {
        ...VALID_HCAPTCHA,
        hcaptchaSecretKey: `0x${'f'.repeat(40)}`,
      });
      const rejectedLoginPromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      const rejectedLogin = await rejectedLoginPromise;
      expect(rejectedLogin.status()).toBe(401);
      await expect(page.getByRole('alert')).toContainText('CAPTCHA');
      evidence.push({ phase: 'provider-rejected', status: rejectedLogin.status(), body: await rejectedLogin.json() });

      await setCaptchaConfig(request, VALID_HCAPTCHA);
      const repeatedLoginRequest = page
        .waitForRequest(
          (candidate) => candidate.url().endsWith('/api/v1/auth/login') && candidate.method() === 'POST',
          {
            timeout: 2_000,
          },
        )
        .catch(() => undefined);
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      expect(await repeatedLoginRequest).toBeUndefined();
      await expect(page.getByRole('alert')).toHaveText(CAPTCHA_REQUIRED_MESSAGE);
      evidence.push({ phase: 'post-rejection-reset', loginRequestSent: false, alert: CAPTCHA_REQUIRED_MESSAGE });

      for (const viewport of [
        { name: '1280x800', width: 1280, height: 800 },
        { name: '320x667', width: 320, height: 667 },
        { name: '375x812', width: 375, height: 812 },
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await expect(page.getByRole('alert')).toHaveText(CAPTCHA_REQUIRED_MESSAGE);
        await recordCaptchaMetrics(page, testInfo, `login-captcha-rejected-reset-${viewport.name}.metrics.json`);
        const screenshotPath = testInfo.outputPath(`m01-login-captcha-rejected-reset-${viewport.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled', caret: 'hide' });
        await testInfo.attach(`M01 CAPTCHA rejected/reset ${viewport.name}`, {
          path: screenshotPath,
          contentType: 'image/png',
        });
      }
    });

    await step('a fresh real test token completes Login successfully', async () => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await completeHcaptchaTestWidget(page);
      const successLoginPromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      const successLogin = await successLoginPromise;
      expect(successLogin.status()).toBe(200);
      await expect(page).toHaveURL(/\/$/);
      const authStatus = await page.context().request.get('/api/v1/auth/status');
      expect(authStatus.status()).toBe(200);
      await expect(authStatus.json()).resolves.toMatchObject({
        isAuthenticated: true,
        user: { username: E2E_ADMIN.username },
      });
      evidence.push({ phase: 'fresh-token-success', status: successLogin.status() });
    });

    const evidencePath = testInfo.outputPath('m01-login-captcha-token-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach('M01 CAPTCHA token lifecycle evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await restoreCaptcha(request);
  }
});
