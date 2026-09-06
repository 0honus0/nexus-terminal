import { writeFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type BrowserContext } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';

const TEMP_PASSWORD = 'E2e-Temporary-Password-2026!';

async function login(request: APIRequestContext, password: string): Promise<boolean> {
  const response = await request.post('/api/v1/auth/login', {
    data: { username: E2E_ADMIN.username, password, rememberMe: false },
  });
  return response.ok();
}

async function restoreDefaultPassword(request: APIRequestContext): Promise<void> {
  await request.post('/api/v1/auth/logout').catch(() => undefined);
  if (await login(request, TEMP_PASSWORD)) {
    const restore = await request.put('/api/v1/auth/password', {
      data: { currentPassword: TEMP_PASSWORD, newPassword: E2E_ADMIN.password },
    });
    expect(restore.ok()).toBeTruthy();
    await request.post('/api/v1/auth/logout');
  }
  if (!(await login(request, E2E_ADMIN.password))) {
    throw new Error('failed to restore the default E2E administrator password');
  }
}

async function addVirtualAuthenticator(context: BrowserContext, page: import('@playwright/test').Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const result = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId: result.authenticatorId };
}

test('password change UI updates the real login credential and can restore the test account', async ({
  page,
  context,
}, testInfo) => {
  await loginAsInitialAdmin(context.request);
  let passwordChanged = false;

  try {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Security', exact: true }).click();
    const form = page.getByTestId('change-password-settings');
    await expect(form).toBeVisible();

    const collectMetrics = async (name: string) => {
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
          viewport: { width: window.innerWidth, height: window.innerHeight },
          page: {
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            bodyClientWidth: document.body.clientWidth,
            bodyScrollWidth: document.body.scrollWidth,
          },
          elements: {
            settings: readRect('[data-testid="change-password-settings"]'),
            current: readRect('[data-testid="change-password-current"]'),
            newPassword: readRect('[data-testid="change-password-new"]'),
            confirm: readRect('[data-testid="change-password-confirm"]'),
            submit: readRect('[data-testid="change-password-submit"]'),
            message: readRect('[data-testid="change-password-settings"] [role="status"]'),
          },
        };
      });
      await writeFile(testInfo.outputPath(`change-password-${name}.metrics.json`), JSON.stringify(metrics, null, 2));
      return metrics;
    };

    const beforeMetrics = await collectMetrics('before');
    expect(beforeMetrics.page.scrollWidth).toBe(beforeMetrics.page.clientWidth);
    expect(beforeMetrics.page.bodyScrollWidth).toBe(beforeMetrics.page.bodyClientWidth);
    await captureFunctionalScreenshot(page, 'm05-04a-change-password-before.png', {
      viewport: { width: 1440, height: 900 },
    });

    await step('client validation keeps incomplete password submissions local', async () => {
      const requestPromise = page
        .waitForRequest((request) => request.url().endsWith('/api/v1/auth/password') && request.method() === 'PUT', {
          timeout: 1_000,
        })
        .catch(() => undefined);
      await form.getByTestId('change-password-submit').click();
      await expect(form).toContainText('Please fill in all password fields.');
      expect(await requestPromise).toBeUndefined();

      await form.getByTestId('change-password-current').fill(E2E_ADMIN.password);
      await form.getByTestId('change-password-new').fill(TEMP_PASSWORD);
      await form.getByTestId('change-password-confirm').fill(`${TEMP_PASSWORD}-mismatch`);
      const mismatchRequest = page
        .waitForRequest((request) => request.url().endsWith('/api/v1/auth/password') && request.method() === 'PUT', {
          timeout: 1_000,
        })
        .catch(() => undefined);
      await form.getByTestId('change-password-submit').click();
      await expect(form).toContainText('New password and confirmation do not match.');
      expect(await mismatchRequest).toBeUndefined();
    });

    await step('the API rejects a wrong current password without losing form input', async () => {
      await form.getByTestId('change-password-current').fill('Definitely-Wrong-Current-Password!');
      await form.getByTestId('change-password-confirm').fill(TEMP_PASSWORD);
      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/password') && response.request().method() === 'PUT',
      );
      await form.getByTestId('change-password-submit').click();
      expect((await responsePromise).status()).toBe(400);
      await expect(form).toContainText('当前密码不正确。');
      await expect(form.getByTestId('change-password-current')).toHaveValue('Definitely-Wrong-Current-Password!');
      await expect(form.getByTestId('change-password-new')).toHaveValue(TEMP_PASSWORD);
      await expect(form.getByTestId('change-password-confirm')).toHaveValue(TEMP_PASSWORD);
    });

    await step('change the administrator password through the security UI', async () => {
      await form.getByTestId('change-password-current').fill(E2E_ADMIN.password);
      await form.getByTestId('change-password-new').fill(TEMP_PASSWORD);
      await form.getByTestId('change-password-confirm').fill(TEMP_PASSWORD);
      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/password') && response.request().method() === 'PUT',
      );
      await form.getByTestId('change-password-submit').click();
      expect((await responsePromise).ok()).toBeTruthy();
      passwordChanged = true;
      await expect(form.getByTestId('change-password-current')).toHaveValue('');
      await expect(form.getByTestId('change-password-new')).toHaveValue('');
      await expect(form.getByTestId('change-password-confirm')).toHaveValue('');
      await expect(form).toContainText('Password changed successfully!');

      const authenticatedStatus = await context.request.get('/api/v1/auth/status');
      expect(authenticatedStatus.ok()).toBeTruthy();
      await expect(authenticatedStatus.json()).resolves.toMatchObject({ isAuthenticated: true });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('tab', { name: 'Security', exact: true }).click();
      await expect(page.getByTestId('change-password-settings')).toBeVisible();
      await expect(page.getByTestId('change-password-current')).toHaveValue('');
      await expect(page.getByTestId('change-password-new')).toHaveValue('');
      await expect(page.getByTestId('change-password-confirm')).toHaveValue('');
      const afterMetrics = await collectMetrics('after');
      expect(afterMetrics.page.scrollWidth).toBe(afterMetrics.page.clientWidth);
      expect(afterMetrics.page.bodyScrollWidth).toBe(afterMetrics.page.bodyClientWidth);
      await captureFunctionalScreenshot(page, 'm05-04a-change-password-after.png', {
        viewport: { width: 1440, height: 900 },
      });
    });

    await step('the new password authenticates after logout', async () => {
      expect((await context.request.post('/api/v1/auth/logout')).ok()).toBeTruthy();
      expect(await login(context.request, TEMP_PASSWORD)).toBeTruthy();
      const status = await context.request.get('/api/v1/auth/status');
      await expect(status.json()).resolves.toMatchObject({
        isAuthenticated: true,
        user: { username: E2E_ADMIN.username },
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/settings$/);
    });

    await step('restore the standard E2E password for following tests', async () => {
      const restore = await context.request.put('/api/v1/auth/password', {
        data: { currentPassword: TEMP_PASSWORD, newPassword: E2E_ADMIN.password },
      });
      expect(restore.ok()).toBeTruthy();
      passwordChanged = false;
      expect((await context.request.post('/api/v1/auth/logout')).ok()).toBeTruthy();
      expect(await login(context.request, E2E_ADMIN.password)).toBeTruthy();
    });
  } finally {
    if (passwordChanged) await restoreDefaultPassword(context.request);
  }
});

test('passkey settings UI registers, renames, reloads, and deletes a real credential', async ({
  page,
  context,
}, testInfo) => {
  await loginAsInitialAdmin(context.request);
  const { cdp, authenticatorId } = await addVirtualAuthenticator(context, page);

  try {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Security', exact: true }).click();
    const panel = page.getByRole('heading', { name: 'Passkey Management', exact: true }).locator('..');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('No Passkeys registered yet.');
    await panel.scrollIntoViewIfNeeded();
    const collectPasskeyMetrics = async (name: string) => {
      const metrics = await panel.evaluate((panelElement) => {
        const listItem = panelElement.querySelector<HTMLElement>('li');
        const rect = (element: HTMLElement | null) => {
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          page: {
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          },
          panel: rect(panelElement),
          listItem: rect(listItem),
        };
      });
      await writeFile(testInfo.outputPath(`passkey-${name}.metrics.json`), JSON.stringify(metrics, null, 2));
    };
    await collectPasskeyMetrics('before');
    await captureFunctionalScreenshot(page, 'm05-04c-passkey-before.png', {
      viewport: { width: 1440, height: 900 },
    });

    await step('register a passkey through the real Security UI', async () => {
      const optionsPromise = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/auth/passkey/registration-options') &&
          response.request().method() === 'POST',
      );
      const registerPromise = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/auth/passkey/register') && response.request().method() === 'POST',
      );
      await panel.getByRole('button', { name: 'Register New Passkey', exact: true }).click();
      expect((await optionsPromise).ok()).toBeTruthy();
      expect((await registerPromise).status()).toBe(201);
      await expect(panel.locator('li').first()).toContainText('Unnamed Passkey');
    });

    const row = panel.locator('li').first();
    const passkeys = await context.request.get('/api/v1/auth/user/passkeys');
    expect(passkeys.ok()).toBeTruthy();
    const passkeyList = (await passkeys.json()) as Array<{ credentialId: string; name?: string }>;
    expect(passkeyList).toHaveLength(1);
    const credentialId = passkeyList[0]?.credentialId;
    expect(credentialId).toBeTruthy();

    await step('rename the registered passkey and persist the name', async () => {
      await row.getByTitle('Edit').click();
      const nameInput = row.locator('input');
      await nameInput.fill('E2E Security Key');
      const renamePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/auth/user/passkeys/${credentialId}/name`) &&
          response.request().method() === 'PUT',
      );
      await row.getByRole('button', { name: 'Save', exact: true }).click();
      expect((await renamePromise).ok()).toBeTruthy();
      await expect(row).toContainText('E2E Security Key');
      const renamed = await context.request.get('/api/v1/auth/user/passkeys');
      await expect(renamed.json()).resolves.toMatchObject([{ credentialId, name: 'E2E Security Key' }]);
    });

    await step('reload keeps the renamed passkey visible', async () => {
      await page.reload();
      await page.getByRole('tab', { name: 'Security', exact: true }).click();
      const reloadedPanel = page.getByRole('heading', { name: 'Passkey Management', exact: true }).locator('..');
      await expect(reloadedPanel.locator('li').first()).toContainText('E2E Security Key');
      await reloadedPanel.scrollIntoViewIfNeeded();
      await collectPasskeyMetrics('after');
      await captureFunctionalScreenshot(page, 'm05-04c-passkey-after.png', {
        viewport: { width: 1440, height: 900 },
      });
    });

    await step('delete the registered passkey and persist the empty state', async () => {
      const reloadedPanel = page.getByRole('heading', { name: 'Passkey Management', exact: true }).locator('..');
      const deletePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/auth/user/passkeys/${credentialId}`) &&
          response.request().method() === 'DELETE',
      );
      await reloadedPanel.locator('li').first().getByRole('button', { name: 'Delete', exact: true }).click();
      expect((await deletePromise).ok()).toBeTruthy();
      await expect(reloadedPanel).toContainText('No Passkeys registered yet.');
      const deleted = await context.request.get('/api/v1/auth/user/passkeys');
      await expect(deleted.json()).resolves.toEqual([]);
    });
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => undefined);
    await cdp.send('WebAuthn.disable').catch(() => undefined);
  }
});
