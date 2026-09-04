import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step } from '../../support/steps';

const COMMAND_NAME = 'E2E Collapsible Search Command';

async function recreateQuickCommand(request: APIRequestContext): Promise<number> {
  const list = await request.get('/api/v1/quick-commands');
  expect(list.ok()).toBeTruthy();
  const commands = (await list.json()) as Array<{ id: number; name?: string }>;
  for (const command of commands.filter((item) => item.name === COMMAND_NAME)) {
    expect((await request.delete(`/api/v1/quick-commands/${command.id}`)).ok()).toBeTruthy();
  }

  const create = await request.post('/api/v1/quick-commands', {
    data: {
      name: COMMAND_NAME,
      command: "printf 'COLLAPSIBLE_SEARCH_E2E\\n'",
      tagIds: [],
      variables: {},
    },
  });
  expect(create.status()).toBe(201);
  const body = (await create.json()) as { command: { id: number } };
  return body.command.id;
}

test('quick command search stays visible by default and can be collapsed behind a settings toggle', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();

  const originalResponse = await context.request.get('/api/v1/settings');
  expect(originalResponse.ok()).toBeTruthy();
  const original = (await originalResponse.json()) as {
    language?: string;
    quickCommandsCollapsibleSearch?: boolean;
  };
  const originalTagVisibilityResponse = await context.request.get('/api/v1/settings/show-quick-command-tags');
  expect(originalTagVisibilityResponse.ok()).toBeTruthy();
  const originalTagVisibility = (await originalTagVisibilityResponse.json()) as { enabled?: boolean };

  const normalize = await context.request.put('/api/v1/settings', {
    data: {
      language: 'en-US',
      quickCommandsCollapsibleSearch: false,
    },
  });
  expect(normalize.ok()).toBeTruthy();
  const normalizeTags = await context.request.put('/api/v1/settings/show-quick-command-tags', {
    data: { enabled: false },
  });
  expect(normalizeTags.ok()).toBeTruthy();

  const commandId = await recreateQuickCommand(context.request);
  const connectionId = await ensureTestSshConnection(context.request);

  try {
    await connectTestSshFromConnectionsPage(page, connectionId);

    await step('default-off setting keeps the existing search box visible', async () => {
      const quickView = page.getByTestId('quick-commands-view').filter({ visible: true }).first();
      await expect(quickView.locator(`[data-command-id="${commandId}"]`)).toBeVisible({ timeout: 20_000 });
      await expect(quickView.getByTestId('quick-command-search')).toBeVisible();
      await expect(quickView.getByTestId('quick-command-search-toggle')).toHaveCount(0);
    });

    await step('workspace settings enables collapsed search and persists it on the backend', async () => {
      await page.goto('/settings');
      const settings = page.getByTestId('preferences-settings');
      await expect(settings).toBeVisible();

      const checkbox = settings.getByRole('checkbox', {
        name: 'Collapse the search box into a search button by default',
        exact: true,
      });
      await expect(checkbox).not.toBeChecked();
      await checkbox.check();

      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await settings.getByRole('button', { name: 'Save', exact: true }).click();
      expect((await responsePromise).ok()).toBeTruthy();

      const persisted = await context.request.get('/api/v1/settings');
      expect(persisted.ok()).toBeTruthy();
      expect(
        ((await persisted.json()) as { quickCommandsCollapsibleSearch?: boolean }).quickCommandsCollapsibleSearch,
      ).toBe(true);
    });

    await step('enabled setting replaces the input with a button until search is requested', async () => {
      await connectTestSshFromConnectionsPage(page, connectionId);
      const quickView = page.getByTestId('quick-commands-view').filter({ visible: true }).first();
      const toggle = quickView.getByTestId('quick-command-search-toggle');

      await expect(toggle).toBeVisible({ timeout: 20_000 });
      await expect(quickView.getByTestId('quick-command-search')).toHaveCount(0);
      await toggle.click();

      const search = quickView.getByTestId('quick-command-search');
      await expect(search).toBeVisible();
      await expect(search).toBeFocused();
      await search.fill('Collapsible Search');
      await expect(quickView.locator(`[data-command-id="${commandId}"]`)).toBeVisible();

      await search.fill('');
      await search.press('Escape');
      await expect(search).toHaveCount(0);
      await expect(toggle).toBeVisible();
    });
  } finally {
    const restore = await context.request.put('/api/v1/settings', {
      data: {
        language: original.language ?? 'en-US',
        quickCommandsCollapsibleSearch: original.quickCommandsCollapsibleSearch ?? false,
      },
    });
    expect(restore.ok()).toBeTruthy();
    const restoreTags = await context.request.put('/api/v1/settings/show-quick-command-tags', {
      data: { enabled: originalTagVisibility.enabled ?? true },
    });
    expect(restoreTags.ok()).toBeTruthy();
    await context.request.delete(`/api/v1/quick-commands/${commandId}`);
  }
});
