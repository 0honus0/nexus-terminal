import { mkdir, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const WRONG_PASSWORD = 'Definitely-Wrong-E2E-Password!';

const LOGIN_VIEWPORTS = [
  { label: '1280x800', width: 1280, height: 800 },
  { label: '320x667', width: 320, height: 667 },
  { label: '375x812', width: 375, height: 812 },
] as const;

const LOGIN_METRIC_TARGETS = {
  username: { selector: '#username', labelSelector: 'label[for="username"]' },
  password: { selector: '#password', labelSelector: 'label[for="password"]' },
  rememberMe: { selector: 'label[for="rememberMe"]' },
  alert: { selector: '[role="alert"]' },
  submit: { selector: 'form button[type="submit"]' },
} as const;

async function collectLoginMetrics(page: Page, viewport: (typeof LOGIN_VIEWPORTS)[number]) {
  return page.evaluate(
    ({ targets, expectedViewport }) => {
      const styleProperties = [
        '--app-bg-color',
        '--text-color',
        '--text-color-secondary',
        '--border-color',
        '--link-active-color',
        '--input-focus-border-color',
        '--input-focus-glow',
        '--status-error-color',
        '--button-bg-color',
        '--button-text-color',
      ];
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      const readRect = (element: Element | null) => {
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
      const textRect = (element: Element | null) => {
        if (!element) return null;
        const range = document.createRange();
        range.selectNodeContents(element);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        };
      };
      const pointIsInside = (element: Element | null, rect: ReturnType<typeof readRect>) => {
        if (!element || !rect || rect.width <= 0 || rect.height <= 0) return false;
        const point = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return Boolean(point && (point === element || element.contains(point)));
      };
      const clippingAncestors = (element: HTMLElement | null) => {
        const ancestors: Array<Record<string, unknown>> = [];
        let ancestor = element?.parentElement ?? null;
        while (ancestor) {
          const style = getComputedStyle(ancestor);
          const clipsOverflow = [style.overflowX, style.overflowY].some((value) =>
            ['hidden', 'clip', 'scroll', 'auto'].includes(value),
          );
          const scrollsContent =
            ancestor.scrollWidth > ancestor.clientWidth || ancestor.scrollHeight > ancestor.clientHeight;
          if (clipsOverflow || scrollsContent) {
            ancestors.push({
              tagName: ancestor.tagName.toLowerCase(),
              id: ancestor.id,
              className: String(ancestor.className),
              overflowX: style.overflowX,
              overflowY: style.overflowY,
              rect: readRect(ancestor),
              clientWidth: ancestor.clientWidth,
              clientHeight: ancestor.clientHeight,
              scrollWidth: ancestor.scrollWidth,
              scrollHeight: ancestor.scrollHeight,
            });
          }
          ancestor = ancestor.parentElement;
        }
        return ancestors;
      };
      const readElement = (name: string, target: { selector: string; labelSelector?: string }) => {
        const element = document.querySelector<HTMLElement>(target.selector);
        const label = target.labelSelector ? document.querySelector<HTMLElement>(target.labelSelector) : null;
        const textElement = label ?? element;
        const style = element ? getComputedStyle(element) : null;
        const visibleText = textElement ? (textElement.innerText || textElement.textContent || '').trim() : '';
        const bbox = readRect(element);
        const textBbox = textRect(textElement);
        return {
          name,
          selector: target.selector,
          visible: Boolean(
            element &&
            element.getClientRects().length > 0 &&
            style &&
            style.display !== 'none' &&
            style.visibility !== 'hidden',
          ),
          bbox,
          textBbox,
          obscured: !pointIsInside(element, bbox),
          textObscured: !pointIsInside(textElement, textBbox),
          visibleText,
          labelText: label?.innerText?.trim() || undefined,
          style: style
            ? {
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                fontWeight: style.fontWeight,
                color: style.color,
                backgroundColor: style.backgroundColor,
                borderColor: style.borderColor,
                margin: style.margin,
                marginTop: style.marginTop,
                marginBottom: style.marginBottom,
                padding: style.padding,
                paddingTop: style.paddingTop,
                paddingBottom: style.paddingBottom,
                outlineColor: style.outlineColor,
                boxShadow: style.boxShadow,
              }
            : null,
          clippingAncestors: clippingAncestors(element),
        };
      };
      const focusStyles: Record<string, Record<string, string>> = {};
      const previousFocus = document.activeElement as HTMLElement | null;
      for (const target of Object.values(targets)) {
        const element = document.querySelector<HTMLElement>(target.selector);
        if (!element || (element instanceof HTMLInputElement && element.type === 'hidden')) continue;
        element.focus({ preventScroll: true });
        const style = getComputedStyle(element);
        focusStyles[target.selector] = {
          borderColor: style.borderColor,
          outlineColor: style.outlineColor,
          boxShadow: style.boxShadow,
        };
      }
      previousFocus?.focus({ preventScroll: true });
      const readVariables = Object.fromEntries(
        styleProperties.map((property) => [property, rootStyle.getPropertyValue(property).trim()]),
      );
      return {
        capturedAt: new Date().toISOString(),
        viewport: {
          expected: expectedViewport,
          actual: { width: window.innerWidth, height: window.innerHeight },
          device: { isMobile: false, hasTouch: navigator.maxTouchPoints > 0 },
        },
        page: {
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight,
          bodyScrollWidth: document.body.scrollWidth,
          bodyScrollHeight: document.body.scrollHeight,
          bodyClientWidth: document.body.clientWidth,
          bodyClientHeight: document.body.clientHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
        theme: {
          bodyBackgroundColor: bodyStyle.backgroundColor,
          bodyTextColor: bodyStyle.color,
          rootBackgroundColor: rootStyle.backgroundColor,
          rootTextColor: rootStyle.color,
          cssVariables: readVariables,
        },
        focusStyles,
        elements: Object.fromEntries(
          Object.entries(targets).map(([name, target]) => [name, readElement(name, target)]),
        ),
      };
    },
    { targets: LOGIN_METRIC_TARGETS, expectedViewport: viewport },
  );
}

for (const viewport of LOGIN_VIEWPORTS) {
  test.describe(`M01.03-a ${viewport.label}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: false,
      hasTouch: false,
    });

    test(`invalid password login stays unauthenticated and surfaces the login failure [M01.03-a ${viewport.label}]`, async ({
      page,
      context,
    }, testInfo) => {
      await loginAsInitialAdmin(context.request);
      const setupState = await context.request.get('/api/v1/auth/needs-setup');
      expect(setupState.ok()).toBeTruthy();
      await expect(setupState.json()).resolves.toEqual({ needsSetup: false });
      expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();
      expect((await context.request.post('/api/v1/auth/logout')).ok()).toBeTruthy();

      let firstLoginStatus = 0;
      let secondLoginStatus = 0;
      let failureUrl = '';
      let successUrl = '';
      let failureStatus = 0;
      let successStatus = 0;
      let successUsername = '';
      let failureMessage = '';

      await step('submit an invalid password through the real login form', async () => {
        const captchaConfigPromise = page.waitForResponse(
          (response) => response.url().endsWith('/api/v1/settings/captcha') && response.request().method() === 'GET',
        );
        const passkeyConfigPromise = page.waitForResponse(
          (response) =>
            response.url().includes('/api/v1/auth/passkey/has-configured') && response.request().method() === 'GET',
        );
        await page.goto('/login');
        const captchaConfigResponse = await captchaConfigPromise;
        expect(captchaConfigResponse.ok()).toBeTruthy();
        await expect(captchaConfigResponse.json()).resolves.toMatchObject({ enabled: false, provider: 'none' });
        const passkeyConfigResponse = await passkeyConfigPromise;
        expect(passkeyConfigResponse.ok()).toBeTruthy();
        await expect(passkeyConfigResponse.json()).resolves.toEqual({ hasPasskeys: false });

        expect(page.viewportSize()).toEqual({ width: viewport.width, height: viewport.height });
        expect(await page.evaluate(() => navigator.maxTouchPoints)).toBe(0);
        await expect(page.getByRole('heading', { name: 'User Login', exact: true })).toBeVisible();
        await expect(page.locator('label[for="username"]')).toContainText('Username');
        await expect(page.locator('label[for="password"]')).toContainText('Password');
        await expect(page.locator('label[for="rememberMe"]')).toContainText('Remember Me');
        await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Login with Passkey', exact: true })).toHaveCount(0);

        await page.locator('#username').fill(E2E_ADMIN.username);
        await page.locator('#password').fill(WRONG_PASSWORD);
        const responsePromise = page.waitForResponse(
          (response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
        );
        await page.locator('form button[type="submit"]').click();
        const response = await responsePromise;
        firstLoginStatus = response.status();
        const responseBody = (await response.json()) as { message?: string };
        failureMessage = responseBody.message ?? '';

        expect(firstLoginStatus).toBe(401);
        await expect(page).toHaveURL(/\/login$/);
        failureUrl = page.url();
        const alert = page.getByRole('alert');
        await expect(alert).toBeVisible();
        await expect(alert).toHaveText(/\S/);
        await expect(page.locator('#username')).toBeVisible();
        await expect(page.locator('#password')).toBeVisible();
        await expect(page.locator('#rememberMe')).toBeVisible();
        await expect(page.locator('form button[type="submit"]')).toBeVisible();
        await expect(page.locator('#username')).toBeEnabled();
        await expect(page.locator('#password')).toBeEnabled();
        await expect(page.locator('#username')).toBeEditable();
        await expect(page.locator('#password')).toBeEditable();
        await expect(page.locator('#rememberMe')).toBeEnabled();
        await expect(page.locator('#rememberMe')).not.toBeChecked();
        await expect(page.locator('form button[type="submit"]')).toBeEnabled();
        await expect(alert).toContainText(failureMessage);
        await page.locator('#rememberMe').check();
        await expect(page.locator('#rememberMe')).toBeChecked();
        await page.locator('#rememberMe').uncheck();
        await expect(page.locator('#rememberMe')).not.toBeChecked();
        await page.locator('form button[type="submit"]').click({ trial: true });
      });

      await step('the server session remains unauthenticated after the failed login', async () => {
        const status = await context.request.get('/api/v1/auth/status');
        failureStatus = status.status();
        expect(failureStatus).toBe(401);
        const body = (await status.json()) as { message?: string };
        expect(body.message).toBeTruthy();
      });

      await step('capture the failed login state and visual metrics', async () => {
        const metrics = await collectLoginMetrics(page, viewport);
        expect(metrics.viewport.actual).toEqual({ width: viewport.width, height: viewport.height });
        expect(metrics.viewport.device).toEqual({ isMobile: false, hasTouch: false });
        expect(metrics.page.scrollWidth).toBeLessThanOrEqual(metrics.page.clientWidth);
        expect(metrics.elements.alert.style?.marginTop).toBe('-8px');
        expect(metrics.elements.alert.style?.marginBottom).toBe('8px');
        for (const [name, element] of Object.entries(metrics.elements)) {
          expect(element.visible, `${name} should be visible`).toBeTruthy();
          expect(element.bbox?.width, `${name} width`).toBeGreaterThan(0);
          expect(element.bbox?.height, `${name} height`).toBeGreaterThan(0);
          expect(element.textBbox?.width, `${name} text width`).toBeGreaterThan(0);
          expect(element.textBbox?.height, `${name} text height`).toBeGreaterThan(0);
          expect(element.visibleText, `${name} visible text`).toMatch(/\S/);
          expect(element.obscured, `${name} should not be obscured`).toBeFalsy();
          expect(element.textObscured, `${name} text should not be obscured`).toBeFalsy();
          expect(element.bbox?.x, `${name} left edge`).toBeGreaterThanOrEqual(0);
          expect(element.bbox?.right, `${name} right edge`).toBeLessThanOrEqual(viewport.width);
          expect(element.textBbox?.x, `${name} text left edge`).toBeGreaterThanOrEqual(0);
          expect(element.textBbox?.right, `${name} text right edge`).toBeLessThanOrEqual(viewport.width);
        }

        await mkdir(testInfo.outputPath(), { recursive: true });
        const screenshotPath = testInfo.outputPath(`login-failure-${viewport.label}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await testInfo.attach(`M01.03-a ${viewport.label} failure screenshot`, {
          path: screenshotPath,
          contentType: 'image/png',
        });
        const metricsPath = testInfo.outputPath(`login-failure-${viewport.label}.metrics.json`);
        await writeFile(metricsPath, JSON.stringify(metrics, null, 2), 'utf8');
        await testInfo.attach(`M01.03-a ${viewport.label} failure metrics`, {
          path: metricsPath,
          contentType: 'application/json',
        });
      });

      await step('retry with the correct password through the same login form', async () => {
        await page.locator('#password').fill(E2E_ADMIN.password);
        const responsePromise = page.waitForResponse(
          (response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
        );
        await page.locator('form button[type="submit"]').click();
        const response = await responsePromise;
        secondLoginStatus = response.status();
        expect(secondLoginStatus).toBe(200);
        await expect(page).toHaveURL(/\/$/);
        successUrl = page.url();
        const status = await context.request.get('/api/v1/auth/status');
        successStatus = status.status();
        expect(successStatus).toBe(200);
        const body = (await status.json()) as { user?: { username?: string } };
        successUsername = body.user?.username ?? '';
        expect(successUsername).toBe(E2E_ADMIN.username);
        expect(await page.getByRole('alert').count()).toBe(0);
      });

      const flow = {
        viewport,
        loginResponses: [firstLoginStatus, secondLoginStatus],
        authStatusResponses: { afterFailure: failureStatus, afterSuccess: successStatus },
        urls: { afterFailure: failureUrl, afterSuccess: successUrl },
        failureMessage,
        successUsername,
      };
      const flowPath = testInfo.outputPath(`login-flow-${viewport.label}.json`);
      await writeFile(flowPath, JSON.stringify(flow, null, 2), 'utf8');
      await testInfo.attach(`M01.03-a ${viewport.label} flow results`, {
        path: flowPath,
        contentType: 'application/json',
      });
    });
  });
}

test('navigation logout clears the server session and protects authenticated routes', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();

  await step('logout from the authenticated navigation bar', async () => {
    await page.goto('/');
    const logoutResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/auth/logout') && response.request().method() === 'POST',
    );
    await page.getByRole('link', { name: 'Logout', exact: true }).click();
    expect((await logoutResponse).ok()).toBeTruthy();
    await expect(page).toHaveURL(/\/login$/);
  });

  await step('the session is cleared and a protected route redirects back to login', async () => {
    const status = await context.request.get('/api/v1/auth/status');
    expect(status.status()).toBe(401);
    const body = (await status.json()) as { message?: string };
    expect(body.message).toBeTruthy();

    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });
});
