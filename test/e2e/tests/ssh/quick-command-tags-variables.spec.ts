import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const COMMAND_NAME = 'E2E Tagged Variable Command';
const TAG_NAME = 'E2E Quick Variable Tag';
const RENAMED_TAG = 'E2E Quick Variable Tag Renamed';

async function cleanup(request: APIRequestContext): Promise<void> {
  const commandsResponse = await request.get('/api/v1/quick-commands');
  if (commandsResponse.ok()) {
    const commands = (await commandsResponse.json()) as Array<{ id: number; name?: string }>;
    for (const command of commands.filter((item) => item.name === COMMAND_NAME)) {
      await request.delete(`/api/v1/quick-commands/${command.id}`);
    }
  }

  const tagsResponse = await request.get('/api/v1/quick-command-tags');
  if (tagsResponse.ok()) {
    const tags = (await tagsResponse.json()) as Array<{ id: number; name: string }>;
    for (const tag of tags.filter((item) => [TAG_NAME, RENAMED_TAG].includes(item.name))) {
      await request.delete(`/api/v1/quick-command-tags/${tag.id}`);
    }
  }
}

test('quick command tags and saved variables survive persistence, grouping, rename, and real SSH execution', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: { language: 'en-US' },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: { showQuickCommandTags: true },
      })
    ).ok(),
  ).toBeTruthy();
  await cleanup(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  let commandId = 0;
  let tagId = 0;

  try {
    const quickView = page.getByTestId('quick-commands-view').filter({ visible: true }).first();
    const terminalRows = page.getByTestId('terminal').locator('.xterm-rows');
    await expect(quickView).toBeVisible({ timeout: 20_000 });

    await step(
      'quick command toolbar controls shrink with a narrow workspace pane without horizontal overflow',
      async () => {
        const controls = quickView.locator('.quick-commands-controls');
        const buttons = controls.locator('.quick-control');
        const wideButtonWidth = (await buttons.first().boundingBox())?.width ?? 0;
        expect(wideButtonWidth).toBeGreaterThan(0);

        await page.setViewportSize({ width: 900, height: 700 });
        await expect(quickView).toBeVisible();
        const narrowMetrics = await controls.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        const narrowButtonWidth = (await buttons.first().boundingBox())?.width ?? 0;
        expect(narrowMetrics.scrollWidth).toBeLessThanOrEqual(narrowMetrics.clientWidth + 1);
        expect(narrowButtonWidth).toBeLessThanOrEqual(wideButtonWidth);

        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(quickView).toBeVisible();
      },
    );

    await step('create a tagged command with a persisted substitution variable', async () => {
      await quickView.getByTestId('quick-command-add').click();
      const form = page.getByTestId('quick-command-form');
      await expect(form).toBeVisible();
      await form.getByTestId('quick-command-name').fill(COMMAND_NAME);
      await form.getByTestId('quick-command-command').fill("printf 'QC_TAG_VARIABLE_%s\\n' '${WHO}'");
      await form.getByTestId('quick-command-variable-add').click();
      await form.getByTestId('quick-command-variable-name-0').fill('WHO');
      await form.getByTestId('quick-command-variable-value-0').fill('NEXUS');

      const tagInput = form.getByTestId('tag-input-text');
      await tagInput.fill(TAG_NAME);
      await tagInput.press('Enter');
      await expect
        .poll(
          async () => {
            const response = await context.request.get('/api/v1/quick-command-tags');
            if (!response.ok()) return 0;
            const tag = ((await response.json()) as Array<{ id: number; name: string }>).find(
              (item) => item.name === TAG_NAME,
            );
            return tag?.id ?? 0;
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0);

      const tags = await context.request.get('/api/v1/quick-command-tags');
      tagId = ((await tags.json()) as Array<{ id: number; name: string }>).find((item) => item.name === TAG_NAME)!.id;
      await expect(form.getByTestId('tag-chip').filter({ hasText: TAG_NAME })).toBeVisible();
      await form.getByTestId('quick-command-submit').click();
      await expect(form).toBeHidden({ timeout: 15_000 });

      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/quick-commands');
          if (!response.ok()) return 0;
          const command = ((await response.json()) as Array<{ id: number; name?: string }>).find(
            (item) => item.name === COMMAND_NAME,
          );
          return command?.id ?? 0;
        })
        .toBeGreaterThan(0);
      const commands = await context.request.get('/api/v1/quick-commands');
      commandId = ((await commands.json()) as Array<{ id: number; name?: string }>).find(
        (item) => item.name === COMMAND_NAME,
      )!.id;
    });

    await step('only the tag text enters edit mode while the empty header area toggles the group', async () => {
      const group = quickView.getByTestId(`quick-command-group-${tagId}`);
      const header = group.getByTestId('quick-command-group-header');
      const name = group.getByTestId('quick-command-group-name');
      const toggle = group.locator('button[aria-expanded]').first();
      await expect(header).toBeVisible();
      await expect(name).toBeVisible();

      const headerBox = await header.boundingBox();
      const nameBox = await name.boundingBox();
      expect(headerBox).toBeTruthy();
      expect(nameBox).toBeTruthy();
      expect(nameBox!.x + nameBox!.width).toBeLessThan(headerBox!.x + headerBox!.width - 2);

      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      await header.click({ position: { x: headerBox!.width - 3, y: headerBox!.height / 2 } });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await header.click({ position: { x: headerBox!.width - 3, y: headerBox!.height / 2 } });
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const row = quickView.locator(`[data-command-id="${commandId}"]`);
      await expect(row).toBeVisible();
      const rowPresentation = await row.evaluate((element) => ({
        selected: element.classList.contains('bg-primary/20'),
        userSelect: getComputedStyle(element).userSelect,
        fontSize: Number.parseFloat(
          getComputedStyle(element.querySelector<HTMLElement>('[data-testid="quick-command-execute"]')!).fontSize,
        ),
        fontWeight: Number.parseInt(
          getComputedStyle(element.querySelector<HTMLElement>('[data-testid="quick-command-execute"]')!).fontWeight,
          10,
        ),
        monospaceClass: element
          .querySelector<HTMLElement>('[data-testid="quick-command-execute"]')!
          .classList.contains('font-mono'),
      }));
      expect(rowPresentation.selected).toBe(false);
      expect(rowPresentation.userSelect).toBe('none');
      expect(rowPresentation.fontSize).toBeGreaterThanOrEqual(14);
      expect(rowPresentation.fontWeight).toBeGreaterThanOrEqual(500);
      expect(rowPresentation.monospaceClass).toBe(false);

      await name.click();
      const input = group.getByTestId('quick-command-group-rename-input');
      await expect(input).toBeVisible();
      await input.press('Escape');
      await expect(input).toHaveCount(0);
    });

    await slowStep(
      'the saved variable is substituted when the grouped command executes in the live terminal',
      async () => {
        const group = quickView.getByTestId(`quick-command-group-${tagId}`);
        await expect(group).toContainText(TAG_NAME, { timeout: 15_000 });
        const groupToggle = group.locator('button[aria-expanded]').first();
        if ((await groupToggle.getAttribute('aria-expanded')) === 'false') await groupToggle.click();
        const row = quickView.locator(`[data-command-id="${commandId}"]`);
        await expect(row).toBeVisible();
        await row.getByTestId('quick-command-execute').click();
        await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 }).toContain('QC_TAG_VARIABLE_NEXUS');

        const response = await context.request.get('/api/v1/quick-commands');
        expect(response.ok()).toBeTruthy();
        const saved = (
          (await response.json()) as Array<{
            id: number;
            tagIds?: number[];
            variables?: Record<string, string>;
          }>
        ).find((item) => item.id === commandId);
        expect(saved?.tagIds).toContain(tagId);
        expect(saved?.variables).toMatchObject({ WHO: 'NEXUS' });
      },
    );

    await step('inline tag rename persists and keeps the command in the renamed group', async () => {
      const group = quickView.getByTestId(`quick-command-group-${tagId}`);
      await group.getByTestId('quick-command-group-name').click();
      const input = group.getByTestId('quick-command-group-rename-input');
      await expect(input).toBeVisible();
      await input.fill(RENAMED_TAG);
      await input.press('Enter');

      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/quick-command-tags');
          if (!response.ok()) return '';
          return (
            ((await response.json()) as Array<{ id: number; name: string }>).find((item) => item.id === tagId)?.name ??
            ''
          );
        })
        .toBe(RENAMED_TAG);
      await expect(group.getByTestId('quick-command-group-name')).toHaveText(RENAMED_TAG);
    });
  } finally {
    await cleanup(context.request);
  }
});
