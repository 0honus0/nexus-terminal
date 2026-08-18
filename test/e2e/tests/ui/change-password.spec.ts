import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
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

test('password change UI updates the real login credential and can restore the test account', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  let passwordChanged = false;

  try {
    await page.goto('/settings');
    await page.getByTestId('settings-tab-security').click();
    const form = page.getByTestId('change-password-settings');
    await expect(form).toBeVisible();

    await step('change the administrator password through the security UI', async () => {
      await form.getByTestId('change-password-current').fill(E2E_ADMIN.password);
      await form.getByTestId('change-password-new').fill(TEMP_PASSWORD);
      await form.getByTestId('change-password-confirm').fill(TEMP_PASSWORD);
      const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/password') && response.request().method() === 'PUT');
      await form.getByTestId('change-password-submit').click();
      expect((await responsePromise).ok()).toBeTruthy();
      passwordChanged = true;
      await expect(form.getByTestId('change-password-current')).toHaveValue('');
      await expect(form.getByTestId('change-password-new')).toHaveValue('');
      await expect(form.getByTestId('change-password-confirm')).toHaveValue('');
    });

    await step('the new password authenticates after logout', async () => {
      expect((await context.request.post('/api/v1/auth/logout')).ok()).toBeTruthy();
      expect(await login(context.request, TEMP_PASSWORD)).toBeTruthy();
      const status = await context.request.get('/api/v1/auth/status');
      await expect(status.json()).resolves.toMatchObject({ isAuthenticated: true, user: { username: E2E_ADMIN.username } });
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
