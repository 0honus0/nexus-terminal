import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { step } from '../../support/steps';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { E2E_URLS } from '../../support/test-env';
import type { APIRequestContext, Page, WebSocket as PlaywrightWebSocket, WebSocketRoute } from '@playwright/test';

type AgentEnvelope<T> = { data: T; requestId: string };
type AgentErrorEnvelope = { error: { code: string; message: string }; requestId: string };

type AppSummary = {
  id: string;
  displayName: string;
  version: string;
  stateVersion: number;
  enabled: boolean;
  health: string;
  healthReason: string | null;
  runningRuns: number;
  pendingApprovals: number;
  pendingBudgetRequests: number;
};

type AgentFeatureSettingsView = {
  revision: number;
  effectiveSettings: { feature: { enabled: boolean } };
};

test('Agent launcher stays passive until the user explicitly opens the Hub', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await setUiLanguage(context.request);
  await enableAgentWithRecommendedNexusAgent(context.request);

  await page.goto('/connections');

  const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
  const hub = page.locator('section[aria-label="Agent"]');
  await expect(launcher).toBeVisible();
  await expect(hub).toHaveCount(0);

  await page.getByTestId('connections-add-button').click({ trial: true });

  await launcher.click();
  await expect(hub).toBeVisible();
});

test('Agent feature enable opens one global floating window that survives route navigation', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await setUiLanguage(context.request);
  const initialSettingsResponse = await context.request.get('/api/v1/agent/settings');
  expect(initialSettingsResponse.ok(), await initialSettingsResponse.text()).toBeTruthy();
  const settings = ((await initialSettingsResponse.json()) as AgentEnvelope<AgentFeatureSettingsView>).data;
  expect(settings.effectiveSettings.feature.enabled).toBe(false);
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();

  const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
  const hub = page.getByRole('dialog', { name: 'Agent', exact: true });
  const featureSection = page
    .getByRole('heading', { name: 'Agent feature', exact: true })
    .locator('xpath=ancestor::section[1]');
  await expect(launcher).toHaveCount(0);
  await expect(hub).toHaveCount(0);

  await featureSection.getByRole('button', { name: 'Enable Agent', exact: true }).click();
  const onboarding = page.getByRole('dialog', { name: 'Enable Agent with Nexus Agent', exact: true });
  await expect(onboarding).toBeVisible();
  await expect(onboarding.getByText('Nexus Agent', { exact: true })).toBeVisible();
  await expect(onboarding.getByText('v1.0.0', { exact: true })).toBeVisible();
  await captureFunctionalScreenshot(page, 'agent-onboarding-nexus-agent.png', {
    viewport: { width: 1440, height: 900 },
  });
  await onboarding.getByRole('button', { name: 'Install Nexus Agent & enable Agent', exact: true }).click();

  await expect(onboarding).toHaveCount(0, { timeout: 15_000 });
  await expect(featureSection.getByRole('button', { name: 'Disable Agent', exact: true })).toBeVisible();
  await expect(hub).toBeVisible({ timeout: 10_000 });
  await expect(launcher).toHaveCount(0);
  const settingsBounds = await hub.boundingBox();
  expect(settingsBounds).not.toBeNull();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        rootOverflow: document.documentElement.style.overflow,
        rootOverscroll: document.documentElement.style.overscrollBehavior,
        bodyOverflow: document.body.style.overflow,
        bodyOverscroll: document.body.style.overscrollBehavior,
      })),
    )
    .toEqual({
      rootOverflow: 'hidden',
      rootOverscroll: 'none',
      bodyOverflow: 'hidden',
      bodyOverscroll: 'none',
    });
  const backgroundScrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(
    settingsBounds!.x + Math.min(settingsBounds!.width - 1, settingsBounds!.width / 2),
    settingsBounds!.y + Math.min(settingsBounds!.height - 1, settingsBounds!.height / 2),
  );
  await page.mouse.wheel(0, 1_200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(backgroundScrollBefore);

  const installations = await context.request.get('/api/v1/agent/plugins/installations');
  expect(installations.ok(), await installations.text()).toBeTruthy();
  await expect(installations.json()).resolves.toMatchObject({
    data: expect.arrayContaining([
      expect.objectContaining({ appId: 'nexus.agent', version: '1.0.0', status: 'installed' }),
    ]),
  });

  await page
    .getByRole('link', { name: 'Connections', exact: true })
    .evaluate((element) => (element as HTMLAnchorElement).click());
  await expect(page).toHaveURL(/\/connections$/);
  await expect(hub).toBeVisible();
  await expect(launcher).toHaveCount(0);
  const connectionsBounds = await hub.boundingBox();
  expect(connectionsBounds).toEqual(settingsBounds);

  await page
    .getByRole('link', { name: 'Dashboard', exact: true })
    .evaluate((element) => (element as HTMLAnchorElement).click());
  await expect(page).toHaveURL(/\/$/);
  await expect(hub).toBeVisible();
  await expect(launcher).toHaveCount(0);
});

test('Agent settings surface exposes the production control plane and captures functional evidence', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await setUiLanguage(context.request);
  await enableAgentWithRecommendedNexusAgent(context.request);
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();

  const panel = page.locator('#settings-panel-agent');
  await expect(panel).toBeVisible();
  const settingsNavigation = panel.getByRole('navigation', { name: 'Agent settings sections', exact: true });
  await expect(settingsNavigation).toBeVisible();
  await expect(settingsNavigation.getByRole('button', { name: 'Models & Budget', exact: true })).toBeVisible();
  await expect(settingsNavigation.getByRole('button', { name: 'Runtime & Environments', exact: true })).toBeVisible();
  await expect(settingsNavigation.getByRole('button', { name: 'Plugins & Security', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Agent feature', exact: true })).toBeVisible();
  const providersHeading = panel.getByRole('heading', { name: 'Model providers', exact: true });
  await expect(providersHeading).toBeVisible();
  await captureFunctionalScreenshot(page, 'agent-settings-models.png', { viewport: { width: 1440, height: 900 } });

  const providersSection = providersHeading.locator('xpath=ancestor::section[1]');
  await providersSection.getByRole('button', { name: 'Add provider', exact: true }).first().click();
  const addProvider = page.getByRole('dialog', { name: 'Add Model Provider', exact: true });
  await expect(addProvider).toBeVisible();
  const providerField = (label: string) =>
    addProvider.locator('label').filter({ hasText: label }).locator('input').first();
  await providerField('Display name').fill('Settings UI Provider');
  await providerField('Base URL').fill(`${E2E_URLS.openAiProviderOrigin}/v1`);
  await providerField('Credential').fill('e2e-provider-secret');
  await providerField('Model ID').fill('e2e-model');
  await providerField('Context window').fill('8192');
  await providerField('Maximum output tokens').fill('128');
  await addProvider.getByRole('button', { name: 'Save & Add', exact: true }).click();
  await expect(addProvider).toHaveCount(0);
  const providerName = providersSection.getByText('Settings UI Provider', { exact: true });
  await expect(providerName).toBeVisible();
  const providerCard = providerName.locator('xpath=ancestor::article[1]');
  const protocolSelect = providerCard.getByLabel('Protocol', { exact: true });
  await expect(protocolSelect).toHaveValue('chat-completions');
  await page.route('**/api/v1/agent/ai/providers/*', async (route) => {
    if (route.request().method() === 'PATCH' && route.request().postData()?.includes('"protocol":"responses"')) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await route.continue();
  });
  const protocolSaved = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/ai/providers/') && response.request().method() === 'PATCH',
  );
  await protocolSelect.selectOption('responses');
  await expect(protocolSelect).toHaveValue('responses');
  expect((await protocolSaved).ok()).toBeTruthy();
  await page.unroute('**/api/v1/agent/ai/providers/*');

  await page.route('**/api/v1/agent/ai/providers/*', async (route) => {
    if (route.request().method() === 'PATCH' && route.request().postData()?.includes('"protocol":"chat-completions"')) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'forced protocol failure' } }),
      });
      return;
    }
    await route.continue();
  });
  const failedProtocolPatch = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/ai/providers/') && response.request().method() === 'PATCH',
  );
  await protocolSelect.selectOption('chat-completions');
  await expect(protocolSelect).toHaveValue('chat-completions');
  expect((await failedProtocolPatch).status()).toBe(500);
  await expect(protocolSelect).toHaveValue('responses');
  const errorToast = page.locator('.bg-red-600').last();
  await expect(errorToast).toBeVisible();
  await expect(errorToast).toBeHidden({ timeout: 7_500 });
  await page.unroute('**/api/v1/agent/ai/providers/*');

  const defaultModel = providersSection.getByRole('button', { name: 'Default model for new runs', exact: true });
  await expect(defaultModel).toBeEnabled();
  await defaultModel.click();
  const defaultDropdown = defaultModel.locator('xpath=..');
  const defaultOption = defaultDropdown
    .getByRole('button')
    .filter({ hasText: 'e2e-model' })
    .filter({ hasText: 'Settings UI Provider' });
  await expect(defaultOption).toBeVisible();
  const defaultModelSaved = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/settings') && response.request().method() === 'PATCH',
  );
  await defaultOption.click();
  expect((await defaultModelSaved).ok()).toBeTruthy();
  await expect(defaultModel).toContainText('e2e-model');
  const savedSettings = await context.request.get('/api/v1/agent/settings');
  expect(savedSettings.ok(), await savedSettings.text()).toBeTruthy();
  await expect(savedSettings.json()).resolves.toMatchObject({
    data: { requestedSettings: { model: { defaultModelId: 'e2e-model' } } },
  });

  await providersSection.getByRole('button', { name: 'Models & test (1)', exact: true }).click();
  const testModels = page.getByRole('dialog', { name: 'Configured models & test', exact: true });
  await expect(testModels).toBeVisible();
  const modelRow = testModels
    .getByText('e2e-model', { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');
  await modelRow.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(modelRow).toContainText(/\d+ms/);
  await testModels.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(providersSection.getByText('Model registry', { exact: true })).toBeVisible();
  await expect(providersSection.getByText('Auto update', { exact: true })).toBeVisible();
  await expect(providersSection.getByRole('button', { name: 'Update now', exact: true })).toBeVisible();

  await providersSection.getByRole('button', { name: 'Update models', exact: true }).click();
  const customModelInput = providersSection.getByPlaceholder('Add custom model ID manually', { exact: true });
  await expect(customModelInput).toBeVisible();
  await customModelInput.fill('e2e-custom-no-metadata');
  await customModelInput.locator('xpath=..').getByRole('button', { name: 'Add model', exact: true }).click();

  const capabilityDialog = page.getByRole('dialog', { name: 'Model capabilities', exact: true });
  await expect(capabilityDialog).toBeVisible();
  await expect(capabilityDialog.getByText('e2e-custom-no-metadata', { exact: true })).toBeVisible();
  const capabilityField = (label: string) =>
    capabilityDialog.locator('label').filter({ hasText: label }).locator('input').first();
  await capabilityField('Context window').fill('32768');
  await capabilityField('Maximum output tokens').fill('4096');
  await capabilityDialog
    .getByText('Reasoning levels', { exact: true })
    .locator('xpath=ancestor::label[1]')
    .locator('input')
    .check();
  await capabilityDialog.getByRole('button', { name: 'low', exact: true }).click();
  await capabilityDialog.getByRole('button', { name: 'high', exact: true }).click();
  await capabilityDialog.getByLabel('Default effort').selectOption('high');
  const capabilitySaved = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/ai/providers/') && response.request().method() === 'PATCH',
  );
  await capabilityDialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await capabilitySaved).ok()).toBeTruthy();
  await expect(capabilityDialog).toHaveCount(0);

  const configuredProviders = await context.request.get('/api/v1/agent/ai/providers');
  expect(configuredProviders.ok(), await configuredProviders.text()).toBeTruthy();
  await expect(configuredProviders.json()).resolves.toMatchObject({
    data: [
      expect.objectContaining({
        displayName: 'Settings UI Provider',
        models: expect.arrayContaining([
          expect.objectContaining({
            id: 'e2e-custom-no-metadata',
            contextWindow: 32768,
            maxOutputTokens: 4096,
            reasoningEfforts: ['low', 'high'],
            defaultReasoningEffort: 'high',
          }),
        ]),
      }),
    ],
  });

  const configuredModelsPanel = providersSection
    .getByText('Configured models', { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');
  await expect(configuredModelsPanel.getByTestId('configured-models-remove-all')).toHaveCount(1);
  await expect(configuredModelsPanel.getByRole('checkbox', { name: 'Select all', exact: true })).toHaveCount(0);
  await expect(configuredModelsPanel.getByRole('button', { name: /Remove selected/ })).toHaveCount(0);

  const fallbackSaved = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/settings') && response.request().method() === 'PATCH',
  );
  await providersSection
    .getByRole('button', { name: 'e2e-custom-no-metadata · Settings UI Provider', exact: true })
    .click();
  expect((await fallbackSaved).ok()).toBeTruthy();
  await expect(page.getByText('Fallback chain updated and saved', { exact: true })).toBeVisible();

  await settingsNavigation.getByRole('button', { name: 'Runtime & Environments', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Execution and performance', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Plugin / App execution budget', exact: true })).toBeVisible();
  const workspaceRuntime = panel.getByRole('heading', { name: 'Workspace dev environment', exact: true });
  await workspaceRuntime.scrollIntoViewIfNeeded();
  await expect(workspaceRuntime).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Browser Runtime', exact: true })).toBeAttached();
  await expect(panel.getByRole('heading', { name: 'ACP Runtime', exact: true })).toBeAttached();
  const subagents = panel.getByRole('heading', { name: 'Subagents', exact: true });
  await subagents.scrollIntoViewIfNeeded();
  await expect(subagents).toBeVisible();
  await expect(panel.getByText('Phase 3', { exact: true })).toBeVisible();
  const subagentSection = subagents.locator('xpath=ancestor::section[1]');
  await subagentSection.getByRole('button', { name: 'Add profile', exact: true }).click();
  await expect(subagentSection.getByLabel('Profile ID', { exact: true })).toHaveValue('worker-1');
  await expect(subagentSection.getByLabel('Role', { exact: true })).toHaveValue('Bounded child agent');
  await subagentSection.getByRole('button', { name: 'Save profiles', exact: true }).click();
  await expect(subagentSection.getByLabel('Profile ID', { exact: true })).toHaveValue('worker-1');
  await expect(panel.getByRole('heading', { name: 'Artifacts and storage', exact: true })).toBeAttached();
  await captureFunctionalScreenshot(page, 'agent-settings-runtime.png', { viewport: { width: 1440, height: 900 } });

  await settingsNavigation.getByRole('button', { name: 'Plugins & Security', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Agent apps', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Installable apps and skills', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Globally blocked targets', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'System guardrails', exact: true })).toBeVisible();
  const agentAppsSection = panel
    .getByRole('heading', { name: 'Agent apps', exact: true })
    .locator('xpath=ancestor::section[1]');
  const nexusAgentCard = agentAppsSection
    .getByText('Nexus Agent', { exact: true })
    .first()
    .locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
  await nexusAgentCard.getByRole('button', { name: 'Configure Policies', exact: true }).click();
  const allGranted = nexusAgentCard.getByRole('button', { name: 'Disable all capabilities', exact: true });
  await expect(allGranted).toContainText('Disable');
  await expect(allGranted.locator('.fa-check')).toBeVisible();

  const firstCapability = nexusAgentCard.locator('input[type="checkbox"]').first();
  await expect(firstCapability).toBeChecked();
  await firstCapability.uncheck();
  const partiallyGranted = nexusAgentCard.getByRole('button', { name: 'Enable all capabilities', exact: true });
  await expect(partiallyGranted).toContainText('Enable');
  await expect(partiallyGranted.locator('.fa-minus')).toBeVisible();

  await partiallyGranted.click();
  const restoredAll = nexusAgentCard.getByRole('button', { name: 'Disable all capabilities', exact: true });
  await expect(restoredAll.locator('.fa-check')).toBeVisible();

  await restoredAll.click();
  const noneGranted = nexusAgentCard.getByRole('button', { name: 'Enable all capabilities', exact: true });
  await expect(noneGranted).toContainText('Enable');
  await expect(noneGranted.locator('.fa-check')).toHaveCount(0);
  await expect(noneGranted.locator('.fa-minus')).toHaveCount(0);
  await noneGranted.click();
  await expect(
    nexusAgentCard.getByRole('button', { name: 'Disable all capabilities', exact: true }).locator('.fa-check'),
  ).toBeVisible();

  await captureFunctionalScreenshot(page, 'agent-settings-plugins-security.png', {
    viewport: { width: 1440, height: 900 },
  });

  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  const narrowPanel = page.locator('#settings-panel-agent');
  const narrowNavigation = narrowPanel.getByRole('navigation', { name: 'Agent settings sections', exact: true });
  await expect(narrowNavigation).toBeVisible();
  await narrowNavigation.getByRole('button', { name: 'Runtime & Environments', exact: true }).click();
  await expect(narrowPanel.getByRole('heading', { name: 'Workspace dev environment', exact: true })).toBeVisible();
  const horizontalExcess = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  );
  expect(horizontalExcess).toBeLessThanOrEqual(1);
});

test('fallback settings drop stale models and provider deletion repairs the default route', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await setUiLanguage(context.request);
  await enableAgentWithRecommendedNexusAgent(context.request);
  const csrf = await csrfToken(context.request);
  const headers = { 'X-Nexus-CSRF': csrf };
  const model = (id: string) => ({ id, contextWindow: 8192, maxOutputTokens: 128, supportsTools: true });
  const createProvider = async (displayName: string, models: ReturnType<typeof model>[]) => {
    const response = await context.request.post('/api/v1/agent/ai/providers', {
      headers,
      data: {
        kind: 'openai-compatible',
        displayName,
        baseUrl: `${E2E_URLS.openAiProviderOrigin}/v1`,
        protocol: 'chat-completions',
        credential: 'e2e-provider-secret',
        models,
        enabled: true,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return (
      (await response.json()) as AgentEnvelope<{
        id: string;
        version: number;
        displayName: string;
        models: ReturnType<typeof model>[];
      }>
    ).data;
  };

  let primary = await createProvider('Fallback Primary', [
    model('primary-model'),
    model('stale-fallback'),
    model('valid-fallback'),
  ]);
  const backup = await createProvider('Fallback Backup', [model('backup-model')]);

  const initialSettings = await context.request.get('/api/v1/agent/settings');
  expect(initialSettings.ok(), await initialSettings.text()).toBeTruthy();
  const initial = (
    (await initialSettings.json()) as AgentEnvelope<{
      revision: number;
    }>
  ).data;
  const seededSettings = await context.request.patch('/api/v1/agent/settings', {
    headers,
    data: {
      patch: {
        model: {
          defaultProviderId: primary.id,
          defaultModelId: 'primary-model',
          fallbackModels: [
            { providerId: primary.id, modelId: 'stale-fallback' },
            { providerId: primary.id, modelId: 'valid-fallback' },
          ],
        },
      },
      expectedVersion: initial.revision,
    },
  });
  expect(seededSettings.ok(), await seededSettings.text()).toBeTruthy();

  const removedStaleModel = await context.request.patch(`/api/v1/agent/ai/providers/${primary.id}`, {
    headers,
    data: {
      models: [model('primary-model'), model('valid-fallback')],
      expectedVersion: primary.version,
    },
  });
  expect(removedStaleModel.ok(), await removedStaleModel.text()).toBeTruthy();
  primary = (
    (await removedStaleModel.json()) as AgentEnvelope<{
      id: string;
      version: number;
      displayName: string;
      models: ReturnType<typeof model>[];
    }>
  ).data;

  const staleSettings = await context.request.get('/api/v1/agent/settings');
  expect(staleSettings.ok(), await staleSettings.text()).toBeTruthy();
  await expect(staleSettings.json()).resolves.toMatchObject({
    data: {
      requestedSettings: {
        model: {
          fallbackModels: [
            { providerId: primary.id, modelId: 'stale-fallback' },
            { providerId: primary.id, modelId: 'valid-fallback' },
          ],
        },
      },
    },
  });

  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  const providersSection = page
    .getByRole('heading', { name: 'Model providers', exact: true })
    .locator('xpath=ancestor::section[1]');
  const primaryCard = providersSection.locator(`[data-testid="agent-provider-card"][data-provider-id="${primary.id}"]`);
  await expect(primaryCard).toBeVisible();
  await expect(primaryCard.getByText('Fallback Primary', { exact: true })).toBeVisible();
  await expect(providersSection.getByText('stale-fallback', { exact: true })).toHaveCount(0);

  const validFallback = providersSection.getByRole('button', {
    name: 'valid-fallback · Fallback Primary',
    exact: true,
  });
  const normalizedOff = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/settings') && response.request().method() === 'PATCH',
  );
  await validFallback.click();
  expect((await normalizedOff).ok()).toBeTruthy();
  const afterNormalize = await context.request.get('/api/v1/agent/settings');
  expect(afterNormalize.ok(), await afterNormalize.text()).toBeTruthy();
  await expect(afterNormalize.json()).resolves.toMatchObject({
    data: { requestedSettings: { model: { fallbackModels: [] } } },
  });

  const restoredFallback = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/settings') && response.request().method() === 'PATCH',
  );
  await validFallback.click();
  expect((await restoredFallback).ok()).toBeTruthy();
  const afterRestore = await context.request.get('/api/v1/agent/settings');
  expect(afterRestore.ok(), await afterRestore.text()).toBeTruthy();
  await expect(afterRestore.json()).resolves.toMatchObject({
    data: {
      requestedSettings: {
        model: { fallbackModels: [{ providerId: primary.id, modelId: 'valid-fallback' }] },
      },
    },
  });

  await primaryCard.getByTitle('Delete Provider').click();
  const confirmDelete = page.getByRole('dialog', { name: 'Delete Provider', exact: true });
  await expect(confirmDelete).toBeVisible();
  await expect(
    confirmDelete.getByText('Are you sure you want to delete provider Fallback Primary? This cannot be undone.', {
      exact: true,
    }),
  ).toBeVisible();
  const deleted = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/agent/ai/providers/${primary.id}`) && response.request().method() === 'DELETE',
  );
  const repairedSettings = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/settings') && response.request().method() === 'PATCH',
  );
  await confirmDelete.getByRole('button', { name: 'Delete Provider', exact: true }).click();
  expect((await deleted).ok()).toBeTruthy();
  expect((await repairedSettings).ok()).toBeTruthy();
  await expect(primaryCard).toHaveCount(0);

  const finalSettings = await context.request.get('/api/v1/agent/settings');
  expect(finalSettings.ok(), await finalSettings.text()).toBeTruthy();
  await expect(finalSettings.json()).resolves.toMatchObject({
    data: {
      requestedSettings: {
        model: {
          defaultProviderId: backup.id,
          defaultModelId: 'backup-model',
          fallbackModels: [],
        },
      },
    },
  });
});

const csrfToken = async (request: import('@playwright/test').APIRequestContext): Promise<string> => {
  const response = await request.get('/api/v1/agent/security/csrf');
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.headers()['cache-control']).toContain('no-store');
  const serverTimeMilliseconds = Number(response.headers()['x-agent-server-time-ms']);
  expect(Number.isSafeInteger(serverTimeMilliseconds) && serverTimeMilliseconds > 0).toBeTruthy();
  const body = (await response.json()) as AgentEnvelope<{ token: string }>;
  expect(body.requestId).toBe(response.headers()['x-request-id']);
  expect(body.data.token).toMatch(/^[0-9a-f]{64}$/);
  return body.data.token;
};

const enableAgentWithRecommendedNexusAgent = async (request: APIRequestContext): Promise<AppSummary> => {
  const csrf = await csrfToken(request);
  const installed = await request.post('/api/v1/agent/onboarding/recommended-plugin/install', {
    headers: { 'X-Nexus-CSRF': csrf },
    data: {},
  });
  expect(installed.ok(), await installed.text()).toBeTruthy();
  const installedBody = (await installed.json()) as AgentEnvelope<{ app: AppSummary; installedNow: boolean }>;
  const settingsResponse = await request.get('/api/v1/agent/settings');
  expect(settingsResponse.ok(), await settingsResponse.text()).toBeTruthy();
  const settings = ((await settingsResponse.json()) as AgentEnvelope<AgentFeatureSettingsView>).data;
  if (!settings.effectiveSettings.feature.enabled) {
    const enabled = await request.patch('/api/v1/agent/settings', {
      headers: { 'X-Nexus-CSRF': csrf },
      data: { patch: { feature: { enabled: true } }, expectedVersion: settings.revision },
    });
    expect(enabled.ok(), await enabled.text()).toBeTruthy();
  }
  return installedBody.data.app;
};

const openHostAgentSubscription = async (page: Page, cursor: number, key: string): Promise<void> => {
  await page.evaluate(
    ({ startCursor, probeKey }) =>
      new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/ws/agent`);
        const subscriptionId = `e2e-${probeKey}`;
        const requestId = `subscribe-${probeKey}`;
        const state = { socket, messages: [] as unknown[] };
        const probes = ((
          globalThis as typeof globalThis & { __agentWsProbes?: Record<string, typeof state> }
        ).__agentWsProbes ??= {});
        probes[probeKey] = state;
        const timeout = window.setTimeout(
          () => reject(new Error('Timed out opening Agent WebSocket subscription')),
          10_000,
        );
        socket.addEventListener('open', () => {
          socket.send(
            JSON.stringify({
              type: 'subscribe',
              requestId,
              payload: { subscriptionId, channel: 'host', cursor: startCursor },
            }),
          );
        });
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(String(event.data)) as { type?: string; requestId?: string };
          state.messages.push(message);
          if (message.type === 'subscribed' && message.requestId === requestId) {
            window.clearTimeout(timeout);
            resolve();
          }
        });
        socket.addEventListener('error', () => {
          window.clearTimeout(timeout);
          reject(new Error('Agent WebSocket failed to open'));
        });
        socket.addEventListener('close', (event) => {
          if (socket.readyState !== WebSocket.OPEN) {
            window.clearTimeout(timeout);
            if (state.messages.length === 0)
              reject(new Error(`Agent WebSocket closed before subscribe: ${event.code}`));
          }
        });
      }),
    { startCursor: cursor, probeKey: key },
  );
};

const waitForDurableAgentSequence = async (page: Page, key: string, after: number): Promise<number> => {
  await page.waitForFunction(
    ({ probeKey, minimum }) => {
      const probes = (
        globalThis as typeof globalThis & {
          __agentWsProbes?: Record<string, { messages: Array<{ type?: string; payload?: unknown }> }>;
        }
      ).__agentWsProbes;
      const messages = probes?.[probeKey]?.messages ?? [];
      return messages.some((message) => {
        if (message.type !== 'event' || !message.payload || typeof message.payload !== 'object') return false;
        const payload = message.payload as { durability?: string; sequence?: number };
        return payload.durability === 'durable' && typeof payload.sequence === 'number' && payload.sequence > minimum;
      });
    },
    { probeKey: key, minimum: after },
  );
  return page.evaluate(
    ({ probeKey, minimum }) => {
      const probes = (
        globalThis as typeof globalThis & {
          __agentWsProbes?: Record<string, { messages: Array<{ type?: string; payload?: unknown }> }>;
        }
      ).__agentWsProbes;
      for (const message of probes?.[probeKey]?.messages ?? []) {
        if (message.type !== 'event' || !message.payload || typeof message.payload !== 'object') continue;
        const payload = message.payload as { durability?: string; sequence?: number };
        if (payload.durability === 'durable' && typeof payload.sequence === 'number' && payload.sequence > minimum) {
          return payload.sequence;
        }
      }
      throw new Error('Durable Agent event not found');
    },
    { probeKey: key, minimum: after },
  );
};

const closeAgentSubscription = async (page: Page, key: string): Promise<void> => {
  await page.evaluate(async (probeKey) => {
    const probes = (
      globalThis as typeof globalThis & {
        __agentWsProbes?: Record<string, { socket: WebSocket }>;
      }
    ).__agentWsProbes;
    const socket = probes?.[probeKey]?.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      socket.addEventListener('close', () => resolve(), { once: true });
      socket.close(1000, 'E2E probe complete');
    });
  }, key);
};

const waitForAgentSubscribed = async (socket: PlaywrightWebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Agent WebSocket subscribed acknowledgement'));
    }, 10_000);
    const onFrame = ({ payload }: { payload: string | Buffer }): void => {
      try {
        const message = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as {
          type?: string;
        };
        if (message.type !== 'subscribed') return;
        cleanup();
        resolve();
      } catch {
        // Ignore unrelated/non-JSON frames; the Agent protocol itself will reject malformed payloads.
      }
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('Agent WebSocket closed before subscribed acknowledgement'));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off('framereceived', onFrame);
      socket.off('close', onClose);
    };
    socket.on('framereceived', onFrame);
    socket.on('close', onClose);
  });

const setNexusAgentEnabledFromApi = async (
  request: APIRequestContext,
  enabled: boolean,
  expectedVersion: number,
  csrf: string,
): Promise<AppSummary> => {
  const response = await request.patch('/api/v1/agent/apps/nexus.agent', {
    headers: { 'X-Nexus-CSRF': csrf },
    data: { enabled, expectedVersion },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as AgentEnvelope<AppSummary>).data;
};

const setNexusAgentEnabledFromPage = async (
  page: Page,
  enabled: boolean,
  expectedVersion: number,
): Promise<AppSummary> =>
  page.evaluate(
    async ({ targetEnabled, version }) => {
      const csrfResponse = await fetch('/api/v1/agent/security/csrf', { credentials: 'same-origin' });
      const csrfText = await csrfResponse.text();
      if (!csrfResponse.ok) throw new Error(csrfText);
      const csrf = JSON.parse(csrfText) as { data: { token: string } };
      const response = await fetch('/api/v1/agent/apps/nexus.agent', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-CSRF': csrf.data.token,
        },
        body: JSON.stringify({ enabled: targetEnabled, expectedVersion: version }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text);
      return (JSON.parse(text) as { data: AppSummary }).data;
    },
    { targetEnabled: enabled, version: expectedVersion },
  );

test('Agent Host reconnects automatically and catches up durable Host events', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await setUiLanguage(context.request);
  await enableAgentWithRecommendedNexusAgent(context.request);

  let blockAgentReconnects = false;
  let connectedAgentRoute: WebSocketRoute | undefined;
  let agentConnectionAttempts = 0;
  await page.routeWebSocket('**/ws/agent', async (route) => {
    agentConnectionAttempts += 1;
    if (blockAgentReconnects) {
      await route.close({ code: 1012, reason: 'E2E controlled disconnect' });
      return;
    }
    route.connectToServer();
    connectedAgentRoute = route;
  });

  const apps = await context.request.get('/api/v1/agent/apps');
  expect(apps.ok(), await apps.text()).toBeTruthy();
  const appsBody = (await apps.json()) as AgentEnvelope<AppSummary[]>;
  let agentApp = appsBody.data.find((app) => app.id === 'nexus.agent')!;
  const originalEnabled = agentApp.enabled;
  const csrf = await csrfToken(context.request);
  if (!agentApp.enabled) {
    agentApp = await setNexusAgentEnabledFromApi(context.request, true, agentApp.stateVersion, csrf);
  }

  const initialSocketPromise = page.waitForEvent('websocket', {
    predicate: (socket) => new URL(socket.url()).pathname === '/ws/agent',
  });
  await page.goto('/connections');
  const initialSocket = await initialSocketPromise;
  await waitForAgentSubscribed(initialSocket);

  const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
  const hub = page.locator('section[aria-label="Agent"]');
  await launcher.click();
  await expect(hub).toBeVisible();

  try {
    blockAgentReconnects = true;
    expect(connectedAgentRoute).toBeDefined();
    await connectedAgentRoute!.close({ code: 1012, reason: 'E2E controlled disconnect' });
    await expect.poll(() => agentConnectionAttempts, { timeout: 5_000 }).toBeGreaterThan(1);

    agentApp = await setNexusAgentEnabledFromApi(context.request, false, agentApp.stateVersion, csrf);
    await expect(hub).toBeVisible();

    blockAgentReconnects = false;
    await expect(hub).toHaveCount(0, { timeout: 15_000 });
  } finally {
    blockAgentReconnects = false;
    if (agentApp.enabled !== originalEnabled) {
      agentApp = await setNexusAgentEnabledFromApi(context.request, originalEnabled, agentApp.stateVersion, csrf);
    }
  }
});

test('Agent WebSocket replays durable Host events after a disconnect', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await enableAgentWithRecommendedNexusAgent(context.request);
  await page.goto('/connections');

  const summary = await context.request.get('/api/v1/agent/summary');
  expect(summary.ok(), await summary.text()).toBeTruthy();
  const summaryBody = (await summary.json()) as AgentEnvelope<{ eventCursor: number }>;
  const initialCursor = summaryBody.data.eventCursor;

  const apps = await context.request.get('/api/v1/agent/apps');
  expect(apps.ok(), await apps.text()).toBeTruthy();
  const appsBody = (await apps.json()) as AgentEnvelope<AppSummary[]>;
  const agentApp = appsBody.data.find((app) => app.id === 'nexus.agent')!;
  const originalEnabled = agentApp.enabled;

  await openHostAgentSubscription(page, initialCursor, 'first');
  const toggled = await setNexusAgentEnabledFromPage(page, !originalEnabled, agentApp.stateVersion);
  const firstSequence = await waitForDurableAgentSequence(page, 'first', initialCursor);
  await closeAgentSubscription(page, 'first');

  const restored = await setNexusAgentEnabledFromPage(page, originalEnabled, toggled.stateVersion);
  expect(restored.enabled).toBe(originalEnabled);

  await openHostAgentSubscription(page, firstSequence, 'second');
  const replayedSequence = await waitForDurableAgentSequence(page, 'second', firstSequence);
  expect(replayedSequence).toBeGreaterThan(firstSequence);
  await closeAgentSubscription(page, 'second');

  const retiredHostSse = await context.request.get('/api/v1/agent/events?cursor=0');
  expect(retiredHostSse.status()).toBe(410);
  await expect(retiredHostSse.json()).resolves.toMatchObject({
    error: { code: 'AGENT_STREAM_PROTOCOL_REPLACED' },
  });

  const retiredRunSse = await context.request.get(
    '/api/v1/apps/nexus.agent/runs/00000000-0000-4000-8000-000000000000/events?cursor=0',
  );
  expect(retiredRunSse.status()).toBe(410);
  await expect(retiredRunSse.json()).resolves.toMatchObject({
    error: { code: 'AGENT_STREAM_PROTOCOL_REPLACED' },
  });
});

test('Agent Host event stream elects one cross-tab leader', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await enableAgentWithRecommendedNexusAgent(context.request);

  const leaderSocketPromise = page.waitForEvent('websocket', {
    predicate: (socket) => new URL(socket.url()).pathname === '/ws/agent',
  });
  await page.goto('/connections');
  const leaderSocket = await leaderSocketPromise;
  await waitForAgentSubscribed(leaderSocket);

  const follower = await context.newPage();
  let followerSockets = 0;
  follower.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/ws/agent') followerSockets += 1;
  });
  await follower.goto('/connections');
  await follower.waitForTimeout(750);
  expect(followerSockets).toBe(0);

  await page.close();
  await expect.poll(() => followerSockets, { timeout: 10_000 }).toBe(1);
  await follower.close();
});

test('Agent WebSocket bounds concurrent sockets per authenticated session', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const hostSocketPromise = page.waitForEvent('websocket', {
    predicate: (socket) => new URL(socket.url()).pathname === '/ws/agent',
  });
  await page.goto('/connections');
  const hostSocket = await hostSocketPromise;
  await waitForAgentSubscribed(hostSocket);

  const outcomes = await page.evaluate(async () => {
    const url = `${window.location.origin.replace(/^http/, 'ws')}/ws/agent`;
    const sockets = [new WebSocket(url), new WebSocket(url), new WebSocket(url)];
    const results = await Promise.all(
      sockets.map(
        (socket) =>
          new Promise<'open' | 'rejected'>((resolve) => {
            let settled = false;
            const finish = (result: 'open' | 'rejected') => {
              if (settled) return;
              settled = true;
              resolve(result);
            };
            const timer = window.setTimeout(() => finish('rejected'), 5_000);
            socket.addEventListener('open', () => {
              window.clearTimeout(timer);
              finish('open');
            });
            socket.addEventListener('error', () => {
              window.clearTimeout(timer);
              finish('rejected');
            });
            socket.addEventListener('close', () => {
              window.clearTimeout(timer);
              if (socket.readyState !== WebSocket.OPEN) finish('rejected');
            });
          }),
      ),
    );
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'E2E socket limit probe complete');
    }
    return results;
  });

  expect(outcomes.filter((outcome) => outcome === 'open')).toHaveLength(2);
  expect(outcomes.filter((outcome) => outcome === 'rejected')).toHaveLength(1);
});

test('Agent Host installs Nexus Agent safely and persists explicit lifecycle/settings choices', async ({ request }) => {
  await step('Agent APIs use their own authenticated error envelope', async () => {
    const anonymous = await request.get('/api/v1/agent/apps');
    expect(anonymous.status()).toBe(401);
    const body = (await anonymous.json()) as AgentErrorEnvelope;
    expect(body.error.code).toBe('AUTH_REQUIRED');
    expect(body.requestId).toBe(anonymous.headers()['x-request-id']);
  });

  await loginAsInitialAdmin(request);
  const csrf = await csrfToken(request);
  const mutationHeaders = { 'X-Nexus-CSRF': csrf };

  let agentApp!: AppSummary;

  await step('Nexus Agent is absent from the Host until the signed first-party Plugin is installed', async () => {
    const core = await request.get('/api/v1/status');
    expect(core.ok(), await core.text()).toBeTruthy();

    const before = await request.get('/api/v1/agent/apps');
    expect(before.ok(), await before.text()).toBeTruthy();
    const beforeBody = (await before.json()) as AgentEnvelope<AppSummary[]>;
    expect(beforeBody.data.some((app) => app.id === 'nexus.agent')).toBe(false);

    const recommendation = await request.get('/api/v1/agent/onboarding/recommended-plugin');
    expect(recommendation.ok(), await recommendation.text()).toBeTruthy();
    await expect(recommendation.json()).resolves.toMatchObject({
      data: {
        appId: 'nexus.agent',
        installed: false,
        availableVersion: '1.0.0',
        displayName: 'Nexus Agent',
      },
    });

    const installed = await request.post('/api/v1/agent/onboarding/recommended-plugin/install', {
      headers: mutationHeaders,
      data: {},
    });
    expect(installed.status(), await installed.text()).toBe(201);
    await expect(installed.json()).resolves.toMatchObject({ data: { installedNow: true } });

    await step(
      'installed Nexus Agent recommendation stays local when the official catalog is unavailable',
      async () => {
        const disabled = await request.post(`${E2E_URLS.pluginRepositoryOrigin}/control/official-catalog/disable`);
        expect(disabled.status(), await disabled.text()).toBe(204);
        try {
          const localRecommendation = await request.get('/api/v1/agent/onboarding/recommended-plugin');
          expect(localRecommendation.ok(), await localRecommendation.text()).toBeTruthy();
          await expect(localRecommendation.json()).resolves.toMatchObject({
            data: {
              appId: 'nexus.agent',
              installed: true,
              installedVersion: '1.0.0',
              availableVersion: '1.0.0',
              enabled: true,
            },
          });
        } finally {
          const enabled = await request.post(`${E2E_URLS.pluginRepositoryOrigin}/control/official-catalog/enable`);
          expect(enabled.status(), await enabled.text()).toBe(204);
        }
      },
    );
    const response = await request.get('/api/v1/agent/apps');
    expect(response.ok(), await response.text()).toBeTruthy();
    const body = (await response.json()) as AgentEnvelope<AppSummary[]>;
    expect(body.requestId).toBe(response.headers()['x-request-id']);
    agentApp = body.data.find((app) => app.id === 'nexus.agent')!;
    expect(agentApp).toMatchObject({
      id: 'nexus.agent',
      displayName: 'Nexus Agent',
      version: '1.0.0',
      enabled: true,
      health: 'healthy',
      healthReason: null,
      runningRuns: 0,
      pendingApprovals: 0,
      pendingBudgetRequests: 0,
    });
    expect(JSON.stringify(body)).not.toContain('factory');
    expect(JSON.stringify(body)).not.toContain('app.manifest.json');
  });

  await step(
    'live integration and Browser resource capabilities are declared and default-granted without requiring Runner',
    async () => {
      const response = await request.get('/api/v1/agent/apps/nexus.agent/grants');
      expect(response.ok(), await response.text()).toBeTruthy();
      const body = (await response.json()) as AgentEnvelope<{
        capabilityDefinitions: Array<{ id: string }>;
        grants: Array<{ capability: string }>;
      }>;
      const declaredCapabilities = body.data.capabilityDefinitions.map((definition) => definition.id);
      const grantedCapabilities = body.data.grants.map((grant) => grant.capability);
      expect(declaredCapabilities).toContain('integration.mcp.read');
      expect(declaredCapabilities).toContain('integration.mcp.invoke');
      expect(declaredCapabilities).toContain('integration.acp.invoke');
      expect(declaredCapabilities).toContain('browser.read');
      expect(declaredCapabilities).toContain('browser.interact');
      expect(grantedCapabilities).toContain('integration.acp.invoke');
      expect(grantedCapabilities).toContain('browser.read');
      expect(grantedCapabilities).toContain('browser.interact');
    },
  );

  await step('Agent mutations reject missing CSRF and stale CAS versions', async () => {
    const missingCsrf = await request.patch('/api/v1/agent/apps/nexus.agent', {
      data: { enabled: false, expectedVersion: agentApp.stateVersion },
    });
    expect(missingCsrf.status()).toBe(403);
    await expect(missingCsrf.json()).resolves.toMatchObject({ error: { code: 'CSRF_REJECTED' } });

    const disabled = await request.patch('/api/v1/agent/apps/nexus.agent', {
      headers: mutationHeaders,
      data: { enabled: false, expectedVersion: agentApp.stateVersion },
    });
    expect(disabled.ok(), await disabled.text()).toBeTruthy();
    const disabledBody = (await disabled.json()) as AgentEnvelope<AppSummary>;
    expect(disabledBody.data).toMatchObject({ id: 'nexus.agent', enabled: false, health: 'disabled' });

    const restored = await request.post('/api/v1/agent/onboarding/recommended-plugin/install', {
      headers: mutationHeaders,
      data: {},
    });
    expect(restored.status(), await restored.text()).toBe(201);
    const restoredBody = (await restored.json()) as AgentEnvelope<{ app: AppSummary; installedNow: boolean }>;
    expect(restoredBody.data).toMatchObject({
      installedNow: false,
      app: { id: 'nexus.agent', enabled: true, health: 'healthy', healthReason: null },
    });

    const stale = await request.patch('/api/v1/agent/apps/nexus.agent', {
      headers: mutationHeaders,
      data: { enabled: false, expectedVersion: agentApp.stateVersion },
    });
    expect(stale.status()).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: 'STATE_CONFLICT' } });
    agentApp = restoredBody.data.app;
  });

  await step(
    'Agent settings patch preserves Hard Limits and explicit feature choice through the host state',
    async () => {
      const before = await request.get('/api/v1/agent/settings');
      expect(before.ok(), await before.text()).toBeTruthy();
      const beforeBody = (await before.json()) as AgentEnvelope<{
        requestedSettings: { feature: { enabled: boolean }; hardLimits: { maxConcurrentRuntimes: number } };
        effectiveSettings: { feature: { enabled: boolean } };
        hardLimits: { maxConcurrentRuntimes: number };
        availability: { state: string };
        revision: number;
      }>;
      expect(beforeBody.data).toMatchObject({
        requestedSettings: { feature: { enabled: false } },
        effectiveSettings: { feature: { enabled: false } },
        hardLimits: { maxConcurrentRuntimes: 4 },
        availability: { state: 'disabled' },
        revision: 1,
      });

      const directHardLimit = await request.patch('/api/v1/agent/settings', {
        headers: mutationHeaders,
        data: {
          patch: { hardLimits: { maxConcurrentRuntimes: 5 } },
          expectedVersion: beforeBody.data.revision,
        },
      });
      expect(directHardLimit.status()).toBe(400);
      await expect(directHardLimit.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

      const enabled = await request.patch('/api/v1/agent/settings', {
        headers: mutationHeaders,
        data: { patch: { feature: { enabled: true } }, expectedVersion: beforeBody.data.revision },
      });
      expect(enabled.ok(), await enabled.text()).toBeTruthy();
      const enabledBody = (await enabled.json()) as AgentEnvelope<{
        effectiveSettings: { feature: { enabled: boolean } };
        availability: { state: string };
        revision: number;
      }>;
      expect(enabledBody.data).toMatchObject({
        effectiveSettings: { feature: { enabled: true } },
        availability: { state: 'enabled' },
        revision: 2,
      });

      const reread = await request.get('/api/v1/agent/settings');
      expect(reread.ok(), await reread.text()).toBeTruthy();
      await expect(reread.json()).resolves.toMatchObject({
        data: { effectiveSettings: { feature: { enabled: true } }, revision: enabledBody.data.revision },
      });

      const disabled = await request.patch('/api/v1/agent/settings', {
        headers: mutationHeaders,
        data: { patch: { feature: { enabled: false } }, expectedVersion: enabledBody.data.revision },
      });
      expect(disabled.ok(), await disabled.text()).toBeTruthy();
      await expect(disabled.json()).resolves.toMatchObject({
        data: { effectiveSettings: { feature: { enabled: false } }, availability: { state: 'disabled' }, revision: 3 },
      });
    },
  );

  await step('Browser targets and ACP profiles remain configurable while the optional Runner is absent', async () => {
    const before = await request.get('/api/v1/agent/settings');
    expect(before.ok(), await before.text()).toBeTruthy();
    const beforeBody = (await before.json()) as AgentEnvelope<{ revision: number }>;
    const updated = await request.patch('/api/v1/agent/settings', {
      headers: mutationHeaders,
      data: {
        patch: {
          workspaceRuntime: {
            acpProfiles: [{ id: 'local-acp', argv: ['/usr/bin/example-acp'], cwd: '/workspace' }],
          },
          browser: {
            targets: [
              {
                id: 'direct-chrome',
                endpoints: [
                  {
                    scope: 'external-network',
                    via: 'backend',
                    url: 'http://127.0.0.1:9222',
                    priority: 10,
                    allowPlaintext: true,
                    verifyTls: true,
                  },
                ],
                allowedUrlPatterns: ['https://example.com'],
              },
            ],
          },
        },
        expectedVersion: beforeBody.data.revision,
      },
    });
    expect(updated.ok(), await updated.text()).toBeTruthy();
    await expect(updated.json()).resolves.toMatchObject({
      data: {
        requestedSettings: {
          workspaceRuntime: { acpProfiles: [{ id: 'local-acp' }] },
          browser: {
            targets: [
              {
                id: 'direct-chrome',
                endpoints: [{ scope: 'external-network', via: 'backend', url: 'http://127.0.0.1:9222/' }],
              },
            ],
          },
        },
      },
    });

    const created = await request.post('/api/v1/apps/nexus.agent/integrations', {
      headers: mutationHeaders,
      data: {
        kind: 'acp',
        enabled: true,
        configuration: {
          displayName: 'Local ACP',
          transport: 'workspace-profile',
          profileId: 'local-acp',
          protocolVersion: '1',
        },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const createdBody = (await created.json()) as AgentEnvelope<{ id: string; kind: string; version: number }>;
    expect(createdBody.data).toMatchObject({ kind: 'acp', version: 1 });

    const listed = await request.get('/api/v1/apps/nexus.agent/integrations?kind=acp');
    expect(listed.ok(), await listed.text()).toBeTruthy();
    await expect(listed.json()).resolves.toMatchObject({
      data: [
        {
          id: createdBody.data.id,
          kind: 'acp',
          enabled: true,
          configuration: { profileId: 'local-acp', transport: 'workspace-profile' },
        },
      ],
    });

    const removed = await request.delete(
      `/api/v1/apps/nexus.agent/integrations/${encodeURIComponent(createdBody.data.id)}?expectedVersion=${createdBody.data.version}`,
      { headers: mutationHeaders },
    );
    expect(removed.ok(), await removed.text()).toBeTruthy();
  });

  await step('Workspace Runtime availability reports the optional Runner as not configured', async () => {
    const response = await request.get('/api/v1/agent/workspace-runtime/availability');
    expect(response.ok(), await response.text()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        available: false,
        reason: 'runner_not_configured',
        mode: 'native',
        isolation: 'logical',
      },
    });
  });
});
