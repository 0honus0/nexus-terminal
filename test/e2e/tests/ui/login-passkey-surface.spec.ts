import { writeFile } from 'node:fs/promises';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';

const BASE_URL = 'http://localhost:4173';
const LOGIN_VIEWPORTS = [
  { label: '1280x800', width: 1280, height: 800 },
  { label: '320x667', width: 320, height: 667 },
  { label: '375x812', width: 375, height: 812 },
] as const;

type CdpAudit = {
  methods: string[];
  errors: Array<{ method: string; message: string }>;
};

type AuthenticatorHandle = {
  cdp: CDPSession;
  authenticatorId: string;
  command: <T = unknown>(method: string, params?: object) => Promise<T>;
};

type NetworkEvent = {
  context: string;
  method: string;
  host: string;
  endpoint: string;
  status: number;
};

function describeError(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return String(cause);
}

async function addVirtualAuthenticator(
  context: BrowserContext,
  page: Page,
  audit: CdpAudit,
): Promise<AuthenticatorHandle> {
  const cdp = await context.newCDPSession(page);
  const command = async <T = unknown>(method: string, params?: object): Promise<T> => {
    audit.methods.push(method);
    try {
      return (await cdp.send(method, params)) as T;
    } catch (cause) {
      audit.errors.push({ method, message: describeError(cause) });
      throw cause;
    }
  };

  await command('WebAuthn.enable', { enableUI: false });
  const result = await command<{ authenticatorId: string }>('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId: result.authenticatorId, command };
}

async function removeVirtualAuthenticator(authenticator: AuthenticatorHandle | undefined): Promise<void> {
  if (!authenticator) return;
  await authenticator.command('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: authenticator.authenticatorId,
  }).catch(() => undefined);
  await authenticator.command('WebAuthn.disable').catch(() => undefined);
}

function observeAuthResponses(page: Page, context: string, events: NetworkEvent[]): void {
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/v1/auth/')) return;
    const endpoint = [
      '/api/v1/auth/login',
      '/api/v1/auth/logout',
      '/api/v1/auth/status',
      '/api/v1/auth/passkey/has-configured',
      '/api/v1/auth/passkey/registration-options',
      '/api/v1/auth/passkey/register',
      '/api/v1/auth/passkey/authentication-options',
      '/api/v1/auth/passkey/authenticate',
    ].includes(url.pathname)
      ? url.pathname
      : '/api/v1/auth/<other>';
    events.push({
      context,
      method: response.request().method(),
      host: url.host,
      endpoint,
      status: response.status(),
    });
  });
}

async function collectLoginMetrics(page: Page, testInfo: import('@playwright/test').TestInfo, name: string) {
  const metrics = await page.evaluate(() => {
    const readRect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    return {
      origin: window.location.origin,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      page: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      },
      elements: {
        username: readRect('#username'),
        password: readRect('#password'),
        alert: readRect('[role="alert"]'),
        submit: readRect('form button[type="submit"]'),
        passkey: readRect('form button[type="button"]'),
      },
    };
  });
  await writeFile(testInfo.outputPath(`passkey-login-${name}.metrics.json`), JSON.stringify(metrics, null, 2));
  expect(metrics.origin).toBe(BASE_URL);
  expect(metrics.page.scrollWidth).toBeLessThanOrEqual(metrics.page.clientWidth);
  for (const [elementName, element] of Object.entries(metrics.elements)) {
    expect(element, `${elementName} should be present`).not.toBeNull();
    expect(element?.x, `${elementName} left edge`).toBeGreaterThanOrEqual(0);
    expect(element?.right, `${elementName} right edge`).toBeLessThanOrEqual(metrics.viewport.width);
  }
  return metrics;
}

async function recordCookieMetadata(
  context: BrowserContext,
  contextName: string,
  cookies: Array<{ context: string; name: string; domain: string }>,
): Promise<void> {
  const currentCookies = await context.cookies(BASE_URL);
  for (const cookie of currentCookies) {
    const metadata = { context: contextName, name: cookie.name, domain: cookie.domain };
    if (!cookies.some((item) => item.context === metadata.context && item.name === metadata.name && item.domain === metadata.domain)) {
      cookies.push(metadata);
    }
  }
}

test('M01 Login passkey succeeds, reports credential failure, and falls back to password', async ({
  page,
  context,
  browser,
}, testInfo) => {
  const cdpAudits: Record<string, CdpAudit> = {
    contextA: { methods: [], errors: [] },
    contextB: { methods: [], errors: [] },
  };
  const networkEvents: NetworkEvent[] = [];
  const cookieMetadata: Array<{ context: string; name: string; domain: string }> = [];
  let authenticatorA: AuthenticatorHandle | undefined;
  let authenticatorB: AuthenticatorHandle | undefined;
  let failureContext: BrowserContext | undefined;
  let failurePage: Page | undefined;
  let credentialId = '';
  let registrationObserved = false;
  let successObserved = false;
  let credentialFailureObserved = false;
  let passwordFallbackObserved = false;

  observeAuthResponses(page, 'contextA', networkEvents);

  try {
    authenticatorA = await addVirtualAuthenticator(context, page, cdpAudits.contextA);
    await page.setViewportSize({ width: LOGIN_VIEWPORTS[0].width, height: LOGIN_VIEWPORTS[0].height });
    await page.goto(`${BASE_URL}/login`);
    expect(new URL(page.url()).origin).toBe(BASE_URL);
    await expect(page.getByRole('button', { name: 'Login with Passkey', exact: true })).toHaveCount(0);

    await step('register a real passkey for the Login surface', async () => {
      await page.locator('#username').fill(E2E_ADMIN.username);
      await page.locator('#password').fill(E2E_ADMIN.password);
      const loginResponse = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      expect((await loginResponse).ok()).toBeTruthy();
      await expect(page).toHaveURL(/\/$/);

      await page.goto(`${BASE_URL}/settings`);
      await page.getByRole('tab', { name: 'Security', exact: true }).click();
      const panel = page.getByRole('heading', { name: 'Passkey Management', exact: true }).locator('..');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('No Passkeys registered yet.');

      const optionsResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/auth/passkey/registration-options') &&
          response.request().method() === 'POST',
      );
      const registerResponse = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/passkey/register') && response.request().method() === 'POST',
      );
      await panel.getByRole('button', { name: 'Register New Passkey', exact: true }).click();
      expect((await optionsResponse).status()).toBe(200);
      expect((await registerResponse).status()).toBe(201);

      const passkeysResponse = await context.request.get('/api/v1/auth/user/passkeys');
      expect(passkeysResponse.status()).toBe(200);
      const passkeys = (await passkeysResponse.json()) as Array<{ credentialId: string }>;
      expect(passkeys).toHaveLength(1);
      credentialId = passkeys[0]?.credentialId ?? '';
      expect(credentialId).toBeTruthy();
      registrationObserved = true;
      await recordCookieMetadata(context, 'contextA', cookieMetadata);
    });

    await step('authenticate through Login with the registered passkey', async () => {
      const logoutResponse = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/logout') && response.request().method() === 'POST',
      );
      await page.getByRole('link', { name: 'Logout', exact: true }).click();
      expect((await logoutResponse).ok()).toBeTruthy();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto(`${BASE_URL}/login`);
      await page.locator('#username').fill(E2E_ADMIN.username);
      const passkeyButton = page.getByRole('button', { name: 'Login with Passkey', exact: true });
      await expect(passkeyButton).toBeVisible();
      await captureFunctionalScreenshot(page, 'm01-passkey-login-ready-1280x800.png', {
        viewport: { width: LOGIN_VIEWPORTS[0].width, height: LOGIN_VIEWPORTS[0].height },
      });

      const optionsResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/auth/passkey/authentication-options') &&
          response.request().method() === 'POST',
      );
      const authenticateResponse = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/passkey/authenticate') && response.request().method() === 'POST',
      );
      await passkeyButton.click();
      expect((await optionsResponse).status()).toBe(200);
      expect((await authenticateResponse).status()).toBe(200);
      await expect(page).toHaveURL(/\/$/);
      expect(new URL(page.url()).origin).toBe(BASE_URL);
      const statusResponse = await context.request.get('/api/v1/auth/status');
      expect(statusResponse.status()).toBe(200);
      await expect(statusResponse.json()).resolves.toMatchObject({
        isAuthenticated: true,
        user: { username: E2E_ADMIN.username },
      });
      successObserved = true;
      await recordCookieMetadata(context, 'contextA', cookieMetadata);
      await captureFunctionalScreenshot(page, 'm01-passkey-login-success-1280x800.png', {
        viewport: { width: LOGIN_VIEWPORTS[0].width, height: LOGIN_VIEWPORTS[0].height },
      });
    });

    await step('report a fresh-authenticator credential failure and preserve password fallback', async () => {
      const logoutResponse = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/logout') && response.request().method() === 'POST',
      );
      await page.getByRole('link', { name: 'Logout', exact: true }).click();
      expect((await logoutResponse).ok()).toBeTruthy();
      await expect(page).toHaveURL(/\/login$/);

      failureContext = await browser.newContext({
        baseURL: BASE_URL,
        viewport: { width: LOGIN_VIEWPORTS[0].width, height: LOGIN_VIEWPORTS[0].height },
      });
      failurePage = await failureContext.newPage();
      observeAuthResponses(failurePage, 'contextB', networkEvents);
      authenticatorB = await addVirtualAuthenticator(failureContext, failurePage, cdpAudits.contextB);
      const credentials = await authenticatorB.command<{ credentials: unknown[] }>('WebAuthn.getCredentials', {
        authenticatorId: authenticatorB.authenticatorId,
      });
      expect(credentials.credentials).toHaveLength(0);

      await failurePage.goto(`${BASE_URL}/login`);
      expect(new URL(failurePage.url()).origin).toBe(BASE_URL);
      await failurePage.locator('#username').fill(E2E_ADMIN.username);
      const passkeyButton = failurePage.getByRole('button', { name: 'Login with Passkey', exact: true });
      await expect(passkeyButton).toBeVisible();
      const optionsResponse = failurePage.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/auth/passkey/authentication-options') &&
          response.request().method() === 'POST',
      );
      const authenticateRequest = failurePage
        .waitForRequest(
          (request) => request.url().endsWith('/api/v1/auth/passkey/authenticate') && request.method() === 'POST',
          { timeout: 2_000 },
        )
        .catch(() => undefined);
      await passkeyButton.click();
      expect((await optionsResponse).status()).toBe(200);
      expect(await authenticateRequest).toBeUndefined();
      await expect(failurePage).toHaveURL(/\/login$/);
      const alert = failurePage.getByRole('alert');
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(/\S+/);
      await expect(failurePage.locator('#password')).toBeEditable();
      credentialFailureObserved = true;

      await collectLoginMetrics(failurePage, testInfo, 'failure-1280x800');
      await captureFunctionalScreenshot(failurePage, 'm01-passkey-login-failure-1280x800.png');

      await failurePage.setViewportSize({ width: LOGIN_VIEWPORTS[1].width, height: LOGIN_VIEWPORTS[1].height });
      await collectLoginMetrics(failurePage, testInfo, 'failure-320x667');
      await captureFunctionalScreenshot(failurePage, 'm01-passkey-login-failure-320x667.png');

      await failurePage.setViewportSize({ width: LOGIN_VIEWPORTS[2].width, height: LOGIN_VIEWPORTS[2].height });
      await collectLoginMetrics(failurePage, testInfo, 'failure-375x812');
      await captureFunctionalScreenshot(failurePage, 'm01-passkey-login-failure-375x812.png');

      await failurePage.locator('#password').fill(E2E_ADMIN.password);
      const fallbackLoginResponse = failurePage.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
      );
      await failurePage.getByRole('button', { name: 'Login', exact: true }).click();
      expect((await fallbackLoginResponse).status()).toBe(200);
      await expect(failurePage).toHaveURL(/\/$/);
      expect(new URL(failurePage.url()).origin).toBe(BASE_URL);
      const fallbackStatus = await failureContext.request.get('/api/v1/auth/status');
      expect(fallbackStatus.status()).toBe(200);
      await expect(fallbackStatus.json()).resolves.toMatchObject({
        isAuthenticated: true,
        user: { username: E2E_ADMIN.username },
      });
      passwordFallbackObserved = true;
      await recordCookieMetadata(failureContext, 'contextB', cookieMetadata);
    });
  } finally {
    await removeVirtualAuthenticator(authenticatorB);
    if (failureContext) {
      await failureContext.request.post('/api/v1/auth/logout').catch(() => undefined);
      await failureContext.close().catch(() => undefined);
    }
    if (credentialId) {
      await loginAsInitialAdmin(context.request).catch(() => undefined);
      await context.request.delete(`/api/v1/auth/user/passkeys/${encodeURIComponent(credentialId)}`).catch(() => undefined);
      await context.request.post('/api/v1/auth/logout').catch(() => undefined);
    }
    await removeVirtualAuthenticator(authenticatorA);

    const evidencePath = testInfo.outputPath('passkey-login-evidence.json');
    await writeFile(
      evidencePath,
      JSON.stringify(
        {
          origin: BASE_URL,
          states: {
            registration: registrationObserved,
            success: successObserved,
            credentialFailure: credentialFailureObserved,
            passwordFallback: passwordFallbackObserved,
            cancellation: 'not-exercised; CDP runner exposes presence suppression but no deterministic native cancel action',
          },
          cdp: cdpAudits,
          network: networkEvents,
          cookies: cookieMetadata,
        },
        null,
        2,
      ),
    );
    await testInfo.attach('passkey-login-evidence', { path: evidencePath, contentType: 'application/json' });
  }
});
