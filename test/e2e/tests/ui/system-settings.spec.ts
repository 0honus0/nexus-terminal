import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';

const TARGET_TIMEZONE = 'Asia/Shanghai';
const TARGET_LANGUAGE = 'zh-CN';

test('system settings persist timezone and language changes through the UI', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const originalResponse = await context.request.get('/api/v1/settings');
  expect(originalResponse.ok()).toBeTruthy();
  const original = (await originalResponse.json()) as { language?: string; timezone?: string };

  const normalize = await context.request.put('/api/v1/settings', {
    data: {
      language: 'en-US',
      timezone: 'UTC',
    },
  });
  expect(normalize.ok()).toBeTruthy();

  try {
    await page.goto('/settings');
    await expect(page.getByTestId('preferences-settings')).toBeVisible();
    await expect(page.locator('#languageSelect')).toBeVisible();
    await expect(page.locator('#timezoneSelect')).toBeVisible();
    await captureFunctionalScreenshot(page, 'system-settings.png', { viewport: { width: 1440, height: 900 } });

    await step('save a timezone through the system settings form', async () => {
      const timezone = page.locator('#timezoneSelect');
      const timezoneForm = page.locator('form').filter({ has: timezone });
      await timezone.selectOption(TARGET_TIMEZONE);

      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await timezoneForm.locator('button[type="submit"]').click();
      expect((await responsePromise).ok()).toBeTruthy();

      const persisted = await context.request.get('/api/v1/settings');
      expect(persisted.ok()).toBeTruthy();
      expect(((await persisted.json()) as { timezone?: string }).timezone).toBe(TARGET_TIMEZONE);
    });

    await step('save a language through the system settings form', async () => {
      const language = page.locator('#languageSelect');
      const languageForm = page.locator('form').filter({ has: language });
      await language.selectOption(TARGET_LANGUAGE);

      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await languageForm.locator('button[type="submit"]').click();
      expect((await responsePromise).ok()).toBeTruthy();
      await expect(language).toHaveValue(TARGET_LANGUAGE);

      const persisted = await context.request.get('/api/v1/settings');
      expect(persisted.ok()).toBeTruthy();
      expect(((await persisted.json()) as { language?: string }).language).toBe(TARGET_LANGUAGE);
    });

    await step('both values survive a full settings page reload', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('preferences-settings')).toBeVisible();
      await expect(page.locator('#timezoneSelect')).toHaveValue(TARGET_TIMEZONE);
      await expect(page.locator('#languageSelect')).toHaveValue(TARGET_LANGUAGE);
    });
  } finally {
    const restore = await context.request.put('/api/v1/settings', {
      data: {
        language: original.language ?? 'en-US',
        timezone: original.timezone ?? 'UTC',
      },
    });
    expect(restore.ok()).toBeTruthy();
  }
});

test('dashboard local and remote resource cards can be configured independently', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const originalResponse = await context.request.get('/api/v1/settings');
  expect(originalResponse.ok()).toBeTruthy();
  const original = (await originalResponse.json()) as {
    language?: string;
    dashboardShowLocalResources?: boolean;
    dashboardShowRemoteResources?: boolean;
    remoteHostRefreshIntervalSeconds?: number;
    statusMonitorIntervalSeconds?: number;
  };

  const normalize = await context.request.put('/api/v1/settings', {
    data: {
      language: 'en-US',
      dashboardShowLocalResources: true,
      dashboardShowRemoteResources: true,
      remoteHostRefreshIntervalSeconds: 30,
      statusMonitorIntervalSeconds: 3,
    },
  });
  expect(normalize.ok()).toBeTruthy();

  try {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'System', exact: true }).click();

    const localToggle = page.getByTestId('dashboard-show-local-resources');
    const remoteToggle = page.getByTestId('dashboard-show-remote-resources');
    const refreshInterval = page.getByTestId('dashboard-remote-refresh-interval');
    const resourceForm = page.locator('form').filter({ has: localToggle });
    await expect(localToggle).toBeChecked();
    await expect(remoteToggle).toBeChecked();
    await expect(refreshInterval).toHaveValue('30');

    await step('save an SSH dashboard refresh interval independently from the status monitor', async () => {
      await refreshInterval.fill('17');
      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await resourceForm.locator('button[type="submit"]').click();
      expect((await responsePromise).ok()).toBeTruthy();

      const persisted = await context.request.get('/api/v1/settings');
      expect(persisted.ok()).toBeTruthy();
      const values = (await persisted.json()) as {
        remoteHostRefreshIntervalSeconds?: number;
        statusMonitorIntervalSeconds?: number;
      };
      expect(values.remoteHostRefreshIntervalSeconds).toBe(17);
      expect(values.statusMonitorIntervalSeconds).toBe(3);

      const invalid = await context.request.put('/api/v1/settings', {
        data: { remoteHostRefreshIntervalSeconds: 0 },
      });
      expect(invalid.status()).toBe(400);
    });

    await step('dashboard reflects the dedicated SSH refresh interval', async () => {
      await page.goto('/');
      await expect(page.getByTestId('dashboard-system-resources')).toBeVisible();
      await page.goto('/settings');
      await page.getByRole('tab', { name: 'System', exact: true }).click();
      await expect(page.getByTestId('dashboard-remote-refresh-interval')).toHaveValue('17');
    });

    await step('disable only local dashboard resources', async () => {
      await localToggle.uncheck();
      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await resourceForm.locator('button[type="submit"]').click();
      expect((await responsePromise).ok()).toBeTruthy();

      const persisted = await context.request.get('/api/v1/settings');
      expect(persisted.ok()).toBeTruthy();
      const values = (await persisted.json()) as {
        dashboardShowLocalResources?: boolean;
        dashboardShowRemoteResources?: boolean;
      };
      expect(values.dashboardShowLocalResources).toBe(false);
      expect(values.dashboardShowRemoteResources).toBe(true);
    });

    await step('switch to local-only resources and persist across reload', async () => {
      await localToggle.check();
      await remoteToggle.uncheck();
      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await resourceForm.locator('button[type="submit"]').click();
      expect((await responsePromise).ok()).toBeTruthy();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('tab', { name: 'System', exact: true }).click();
      await expect(page.getByTestId('dashboard-show-local-resources')).toBeChecked();
      await expect(page.getByTestId('dashboard-show-remote-resources')).not.toBeChecked();
      await expect(page.getByTestId('dashboard-remote-refresh-interval')).toHaveValue('17');
    });
  } finally {
    const restore = await context.request.put('/api/v1/settings', {
      data: {
        language: original.language ?? 'en-US',
        dashboardShowLocalResources: original.dashboardShowLocalResources ?? true,
        dashboardShowRemoteResources: original.dashboardShowRemoteResources ?? true,
        remoteHostRefreshIntervalSeconds: original.remoteHostRefreshIntervalSeconds ?? 30,
        statusMonitorIntervalSeconds: original.statusMonitorIntervalSeconds ?? 3,
      },
    });
    expect(restore.ok()).toBeTruthy();
  }
});

test('workspace popup editor setting is the only editor and preview close control', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const originalResponse = await context.request.get('/api/v1/settings');
  expect(originalResponse.ok()).toBeTruthy();
  const original = (await originalResponse.json()) as { language?: string; showPopupFileEditor?: boolean };
  expect(original).not.toHaveProperty('clearFileEditorTabsOnClose');

  const normalize = await context.request.put('/api/v1/settings', {
    data: {
      language: 'en-US',
      showPopupFileEditor: true,
    },
  });
  expect(normalize.ok()).toBeTruthy();

  try {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'System', exact: true }).click();

    const unifiedToggle = page.locator('#showPopupFileEditor');
    const unifiedForm = page.locator('form').filter({ has: unifiedToggle });
    await expect(unifiedToggle).toBeChecked();
    await expect(unifiedToggle.locator('xpath=ancestor::label')).toContainText('Popup File Editor');

    await step('disabling the single control saves only showPopupFileEditor', async () => {
      await unifiedToggle.uncheck();
      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await unifiedForm.locator('button[type="submit"]').click();
      expect((await responsePromise).ok()).toBeTruthy();

      const persisted = await context.request.get('/api/v1/settings');
      expect(persisted.ok()).toBeTruthy();
      const values = (await persisted.json()) as { showPopupFileEditor?: boolean };
      expect(values.showPopupFileEditor).toBe(false);
    });

    await step('enabling the single control saves only showPopupFileEditor', async () => {
      await unifiedToggle.check();
      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await unifiedForm.locator('button[type="submit"]').click();
      expect((await responsePromise).ok()).toBeTruthy();

      const persisted = await context.request.get('/api/v1/settings');
      expect(persisted.ok()).toBeTruthy();
      const values = (await persisted.json()) as { showPopupFileEditor?: boolean };
      expect(values.showPopupFileEditor).toBe(true);
    });
  } finally {
    const restore = await context.request.put('/api/v1/settings', {
      data: {
        language: original.language ?? 'en-US',
        showPopupFileEditor: original.showPopupFileEditor ?? true,
      },
    });
    expect(restore.ok()).toBeTruthy();
  }
});
