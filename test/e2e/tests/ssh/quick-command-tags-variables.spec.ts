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
    const commands = await commandsResponse.json() as Array<{ id: number; name?: string }>;
    for (const command of commands.filter(item => item.name === COMMAND_NAME)) {
      await request.delete(`/api/v1/quick-commands/${command.id}`);
    }
  }

  const tagsResponse = await request.get('/api/v1/quick-command-tags');
  if (tagsResponse.ok()) {
    const tags = await tagsResponse.json() as Array<{ id: number; name: string }>;
    for (const tag of tags.filter(item => [TAG_NAME, RENAMED_TAG].includes(item.name))) {
      await request.delete(`/api/v1/quick-command-tags/${tag.id}`);
    }
  }
}

test('quick command tags and saved variables survive persistence, grouping, rename, and real SSH execution', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect((await context.request.put('/api/v1/settings', {
    data: { language: 'en-US', showQuickCommandTags: 'true' },
  })).ok()).toBeTruthy();
  await cleanup(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  let commandId = 0;
  let tagId = 0;

  try {
    const quickView = page.getByTestId('quick-commands-view');
    const terminalRows = page.getByTestId('terminal').locator('.xterm-rows');
    await expect(quickView).toBeVisible({ timeout: 20_000 });

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
      await expect.poll(async () => {
        const response = await context.request.get('/api/v1/quick-command-tags');
        if (!response.ok()) return 0;
        const tag = (await response.json() as Array<{ id: number; name: string }>).find(item => item.name === TAG_NAME);
        return tag?.id ?? 0;
      }, { timeout: 15_000 }).toBeGreaterThan(0);

      const tags = await context.request.get('/api/v1/quick-command-tags');
      tagId = ((await tags.json() as Array<{ id: number; name: string }>).find(item => item.name === TAG_NAME))!.id;
      await expect(form.getByTestId('tag-chip').filter({ hasText: TAG_NAME })).toBeVisible();
      await form.getByTestId('quick-command-submit').click();
      await expect(form).toBeHidden({ timeout: 15_000 });

      await expect.poll(async () => {
        const response = await context.request.get('/api/v1/quick-commands');
        if (!response.ok()) return 0;
        const command = (await response.json() as Array<{ id: number; name?: string }>).find(item => item.name === COMMAND_NAME);
        return command?.id ?? 0;
      }).toBeGreaterThan(0);
      const commands = await context.request.get('/api/v1/quick-commands');
      commandId = ((await commands.json() as Array<{ id: number; name?: string }>).find(item => item.name === COMMAND_NAME))!.id;
    });

    await slowStep('the saved variable is substituted when the grouped command executes in the live terminal', async () => {
      const group = quickView.getByTestId(`quick-command-group-${tagId}`);
      await expect(group).toContainText(TAG_NAME, { timeout: 15_000 });
      const chevron = group.locator('i').first();
      if ((await chevron.getAttribute('class'))?.includes('fa-chevron-right')) await chevron.click();
      const row = quickView.locator(`[data-command-id="${commandId}"]`);
      await expect(row).toBeVisible();
      await row.click();
      await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 }).toContain('QC_TAG_VARIABLE_NEXUS');

      const response = await context.request.get('/api/v1/quick-commands');
      expect(response.ok()).toBeTruthy();
      const saved = (await response.json() as Array<{
        id: number;
        tagIds?: number[];
        variables?: Record<string, string>;
      }>).find(item => item.id === commandId);
      expect(saved?.tagIds).toContain(tagId);
      expect(saved?.variables).toMatchObject({ WHO: 'NEXUS' });
    });

    await step('inline tag rename persists and keeps the command in the renamed group', async () => {
      const group = quickView.getByTestId(`quick-command-group-${tagId}`);
      await group.getByTestId('quick-command-group-name').click();
      const input = group.getByTestId('quick-command-group-rename-input');
      await expect(input).toBeVisible();
      await input.fill(RENAMED_TAG);
      await input.press('Enter');

      await expect.poll(async () => {
        const response = await context.request.get('/api/v1/quick-command-tags');
        if (!response.ok()) return '';
        return (await response.json() as Array<{ id: number; name: string }>).find(item => item.id === tagId)?.name ?? '';
      }).toBe(RENAMED_TAG);
      await expect(group.getByTestId('quick-command-group-name')).toHaveText(RENAMED_TAG);
    });
  } finally {
    await cleanup(context.request);
  }
});
