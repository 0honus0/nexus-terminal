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
    showQuickCommandTags?: boolean;
  };

  const normalize = await context.request.put('/api/v1/settings', {
    data: {
      language: 'en-US',
      quickCommandsCollapsibleSearch: false,
      showQuickCommandTags: false,
    },
  });
  expect(normalize.ok()).toBeTruthy();

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
      await settings.getByTestId('quick-command-collapsible-search-save').click();
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

      const controls = quickView.locator('.quick-commands-controls');
      const originalQuickViewStyle = await quickView.getAttribute('style');
      const expectCollapsedControlsCentered = async (width: number) => {
        await quickView.evaluate((element, targetWidth) => {
          element.style.width = `${targetWidth}px`;
          element.style.flex = '0 0 auto';
        }, width);
        await expect.poll(async () => (await quickView.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(width - 1);
        await expect(controls).toHaveCSS('justify-content', 'center');
        await expect
          .poll(async () => {
            return controls.evaluate((element) => {
              const controlsBox = element.getBoundingClientRect();
              const rows = new Map<number, DOMRect[]>();
              for (const button of element.querySelectorAll<HTMLElement>('.quick-control')) {
                const box = button.getBoundingClientRect();
                if (!box.width || !box.height) continue;
                const key = Math.round(box.top);
                const row = rows.get(key) ?? [];
                row.push(box);
                rows.set(key, row);
              }
              if (!rows.size) return 999;
              return Math.max(
                ...[...rows.values()].map((row) => {
                  const left = Math.min(...row.map((box) => box.left));
                  const right = Math.max(...row.map((box) => box.right));
                  const leftGap = left - controlsBox.left;
                  const rightGap = controlsBox.right - right;
                  return Math.abs(leftGap - rightGap);
                }),
              );
            });
          })
          .toBeLessThanOrEqual(2);
      };

      try {
        // Cover the full sidebar range: wide panes must not fall back to flex-start, while the
        // compact and wrapping container-query layouts must keep the same centered invariant.
        await expectCollapsedControlsCentered(800);
        await expectCollapsedControlsCentered(300);
        await expectCollapsedControlsCentered(220);
      } finally {
        await quickView.evaluate((element, style) => {
          if (style === null) element.removeAttribute('style');
          else element.setAttribute('style', style);
        }, originalQuickViewStyle);
      }

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
        showQuickCommandTags: original.showQuickCommandTags ?? true,
      },
    });
    expect(restore.ok()).toBeTruthy();
    await context.request.delete(`/api/v1/quick-commands/${commandId}`);
  }
});
