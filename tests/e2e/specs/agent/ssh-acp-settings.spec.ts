import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';

test('SSH ACP settings create and persist without a Workspace profile', async ({ page, context }) => {
  const request = context.request;
  await loginAsInitialAdmin(request);
  await setUiLanguage(request);
  const csrf = (await (await request.get('/api/v1/agent/security/csrf')).json()).data.token;
  const headers = { 'X-Nexus-CSRF': csrf };
  const installed = await request.post('/api/v1/agent/onboarding/recommended-plugin/install', { headers, data: {} });
  expect(installed.ok(), await installed.text()).toBeTruthy();
  const settings = (await (await request.get('/api/v1/agent/settings')).json()).data;
  const configured = await request.patch('/api/v1/agent/settings', {
    headers,
    data: { expectedVersion: settings.revision, patch: { workspaceRuntime: { acpProfiles: [] } } },
  });
  expect(configured.ok(), await configured.text()).toBeTruthy();
  await page.goto('/settings?tab=agent');
  const panel = page.locator('#settings-panel-agent');
  await panel.getByRole('button', { name: 'Runtime & Environments', exact: true }).click();
  const section = panel
    .getByRole('heading', { name: 'ACP Integrations', exact: true })
    .locator('xpath=ancestor::section[1]');
  await section.getByRole('button', { name: 'Add integration', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add ACP Integration', exact: true });
  await dialog.getByRole('textbox', { name: 'Display name' }).fill('SSH ACP settings fixture');
  await expect(dialog.getByRole('button', { name: 'Save & Add', exact: true })).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'Execution target type', exact: true }).click();
  await page.getByRole('option', { name: 'SSH', exact: true }).click();
  await dialog
    .getByRole('textbox', { name: 'SSH argv (JSON array; use env for environment variables)', exact: true })
    .fill('["agent", "--acp", "literal argument"]');
  await dialog
    .getByRole('textbox', { name: 'SSH working directory (absolute path)', exact: true })
    .fill('/srv/project with spaces');
  await dialog.getByRole('button', { name: 'Save & Add', exact: true }).click();
  await expect(dialog).toBeHidden();
  const row = section.locator('article').filter({ hasText: 'SSH ACP settings fixture' });
  await expect(row).toContainText('SSH · /srv/project with spaces');
  await expect(row.getByRole('combobox')).toHaveCount(0);
  const listed = await request.get('/api/v1/apps/nexus.agent/integrations?kind=acp');
  expect(listed.ok(), await listed.text()).toBeTruthy();
  const integration = (await listed.json()).data.find(
    (item: { configuration: { displayName: string } }) => item.configuration.displayName === 'SSH ACP settings fixture',
  );
  expect(integration).toMatchObject({
    enabled: true,
    configuration: {
      transport: 'ssh',
      argv: ['agent', '--acp', 'literal argument'],
      cwd: '/srv/project with spaces',
      protocolVersion: '1',
    },
  });
  const invalid = await request.patch(`/api/v1/apps/nexus.agent/integrations/${integration.id}`, {
    headers,
    data: {
      kind: 'acp',
      enabled: true,
      expectedVersion: integration.version,
      configuration: { ...integration.configuration, cwd: 'relative/path' },
    },
  });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toMatchObject({ error: { code: 'ACP_SSH_CONFIGURATION_INVALID' } });
  await page.reload();
  await panel.getByRole('button', { name: 'Runtime & Environments', exact: true }).click();
  await expect(row).toContainText('SSH · /srv/project with spaces');
  const removed = await request.delete(
    `/api/v1/apps/nexus.agent/integrations/${integration.id}?expectedVersion=${integration.version}`,
    { headers },
  );
  expect(removed.ok(), await removed.text()).toBeTruthy();
});
