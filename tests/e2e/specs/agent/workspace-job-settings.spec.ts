import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';

test('Workspace command capacity validates, saves and survives reload', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await setUiLanguage(context.request);
  await page.goto('/settings?tab=agent');
  const panel = page.locator('#settings-panel-agent');
  await panel.getByRole('button', { name: 'Runtime & Environments', exact: true }).click();
  const section = panel
    .getByRole('heading', { name: 'Execution and performance', exact: true })
    .locator('xpath=ancestor::section[1]');
  const input = section.getByRole('spinbutton', { name: 'Concurrent commands per Workspace' });
  const save = section.getByRole('button', { name: 'Save', exact: true });
  await expect(input).toHaveValue('8');
  for (const value of ['0', '65', '1.5']) {
    await input.fill(value);
    await expect(save).toBeDisabled();
  }
  await input.fill('2');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(section.getByText('Current concurrency settings are in effect', { exact: true })).toBeVisible();
  const persisted = await context.request.get('/api/v1/agent/settings');
  expect(persisted.ok()).toBeTruthy();
  const settings = (await persisted.json()).data;
  expect(settings.requestedSettings.performance.maxConcurrentWorkspaceJobs).toBe(2);
  expect(settings.effectiveSettings.performance.maxConcurrentWorkspaceJobs).toBe(2);
  const csrf = (await (await context.request.get('/api/v1/agent/security/csrf')).json()).data.token;
  for (const value of [0, 65, 1.5]) {
    const rejected = await context.request.patch('/api/v1/agent/settings', {
      headers: { 'X-Nexus-CSRF': csrf },
      data: { expectedVersion: settings.revision, patch: { performance: { maxConcurrentWorkspaceJobs: value } } },
    });
    expect(rejected.status()).toBe(400);
  }
  await page.reload();
  await panel.getByRole('button', { name: 'Runtime & Environments', exact: true }).click();
  await expect(input).toHaveValue('2');
  const unchanged = (await (await context.request.get('/api/v1/agent/settings')).json()).data;
  expect(unchanged.revision).toBe(settings.revision);
  expect(unchanged.effectiveSettings.performance.maxConcurrentWorkspaceJobs).toBe(2);
});
