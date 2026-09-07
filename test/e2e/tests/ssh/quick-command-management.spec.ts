import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const ORIGINAL_NAME = 'E2E Managed Quick Command';
const EDITED_NAME = 'E2E Managed Quick Command Edited';

async function cleanupCommands(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/quick-commands');
  expect(response.ok()).toBeTruthy();
  const commands = (await response.json()) as Array<{ id: number; name?: string }>;
  for (const command of commands.filter((item) => item.name === ORIGINAL_NAME || item.name === EDITED_NAME)) {
    const remove = await request.delete(`/api/v1/quick-commands/${command.id}`);
    expect(remove.ok()).toBeTruthy();
  }
}

async function findCommand(
  request: APIRequestContext,
  name: string,
): Promise<{ id: number; command: string; usageCount?: number } | undefined> {
  const response = await request.get('/api/v1/quick-commands');
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as Array<{ id: number; name?: string; command: string; usageCount?: number }>).find(
    (item) => item.name === name,
  );
}

function markerCount(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

async function captureQuickCommandsEvidence(page: Page, testInfo: TestInfo, name: 'before' | 'after'): Promise<void> {
  const metrics = await page.evaluate(() => {
    const quickView = [...document.querySelectorAll<HTMLElement>('[data-testid="quick-commands-view"]')].find(
      (element) => element.getClientRects().length > 0,
    );
    const list = quickView?.querySelector<HTMLElement>('[data-testid="quick-command-list"]');
    const search = quickView?.querySelector<HTMLElement>('[data-testid="quick-command-search"]');
    const add = quickView?.querySelector<HTMLElement>('[data-testid="quick-command-add"]');
    const rect = (element: Element | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    };
    return {
      language: document.documentElement.lang,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      quickView: rect(quickView ?? null),
      list: rect(list ?? null),
      listClientWidth: list?.clientWidth ?? 0,
      listScrollWidth: list?.scrollWidth ?? 0,
      listClientHeight: list?.clientHeight ?? 0,
      listScrollHeight: list?.scrollHeight ?? 0,
      search: rect(search ?? null),
      add: rect(add ?? null),
      commandCount: quickView?.querySelectorAll('[data-command-id]').length ?? 0,
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--app-bg-color').trim(),
    };
  });
  const screenshotPath = testInfo.outputPath(`quick-command-${name}.png`);
  const metricsPath = testInfo.outputPath(`quick-command-${name}.metrics.json`);
  await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled', caret: 'hide' });
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  await testInfo.attach(`M09.03-a quick command ${name} screenshot`, {
    path: screenshotPath,
    contentType: 'image/png',
  });
  await testInfo.attach(`M09.03-a quick command ${name} metrics`, {
    path: metricsPath,
    contentType: 'application/json',
  });
  console.log(
    `[M09.03-a quick command ${name} metrics] language=${metrics.language} viewport=${metrics.viewport.width}x${metrics.viewport.height} pageScrollWidth=${metrics.pageScrollWidth} bodyScrollWidth=${metrics.bodyScrollWidth} list=${metrics.listClientWidth}/${metrics.listScrollWidth}/${metrics.listClientHeight}/${metrics.listScrollHeight} commands=${metrics.commandCount}`,
  );
  expect(metrics.language).toMatch(/^en(?:-US)?$/);
  expect(metrics.viewport).toEqual({ width: 1280, height: 800 });
  expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.quickView?.x).toBeGreaterThanOrEqual(0);
  expect(metrics.quickView?.right).toBeLessThanOrEqual(metrics.viewport.width + 1);
  expect(metrics.list?.width).toBeGreaterThan(0);
  expect(metrics.search?.width).toBeGreaterThan(0);
  expect(metrics.add?.width).toBeGreaterThan(0);
}

test('quick command UI creates, searches, executes, edits, and deletes a command', async ({
  page,
  context,
}, testInfo) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings/show-quick-command-tags', { data: { enabled: false } });
  expect(settings.ok()).toBeTruthy();
  await cleanupCommands(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const quickView = page.getByTestId('quick-commands-view').filter({ visible: true }).first();
  const terminalRows = page.getByTestId('terminal').locator('.xterm-rows');
  await expect(quickView).toBeVisible({ timeout: 20_000 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await captureQuickCommandsEvidence(page, testInfo, 'before');

  let commandId = 0;
  let defaultDialogSize: { width: number; height: number } | null = null;
  await step('create the command through the workspace UI', async () => {
    await quickView.getByTestId('quick-command-add').click();
    const form = page.getByTestId('quick-command-form');
    await expect(form).toBeVisible();
    const dialog = page.getByRole('dialog', { name: 'Add Quick Command', exact: true });
    const beforeResize = await dialog.boundingBox();
    const resizeHandle = dialog.getByTestId('quick-command-resize-bottom-right');
    const handleBox = await resizeHandle.boundingBox();
    expect(beforeResize).toBeTruthy();
    expect(handleBox).toBeTruthy();
    defaultDialogSize = { width: beforeResize!.width, height: beforeResize!.height };
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 70, handleBox!.y + 50, { steps: 6 });
    await page.mouse.up();
    const afterResize = await dialog.boundingBox();
    expect(afterResize).toBeTruthy();
    expect(afterResize!.width).toBeGreaterThan(beforeResize!.width + 40);
    expect(afterResize!.height).toBeGreaterThan(beforeResize!.height + 30);
    expect(afterResize!.x).toBeGreaterThanOrEqual(0);
    expect(afterResize!.y).toBeGreaterThanOrEqual(0);
    expect(afterResize!.x + afterResize!.width).toBeLessThanOrEqual(1280);
    expect(afterResize!.y + afterResize!.height).toBeLessThanOrEqual(800);
    await form.getByTestId('quick-command-name').fill(ORIGINAL_NAME);
    await form.getByTestId('quick-command-command').fill("printf 'QUICK_MANAGED_V1\\n'");
    await form.getByTestId('quick-command-submit').click();
    await expect(form).toBeHidden({ timeout: 15_000 });

    await expect
      .poll(async () => (await findCommand(context.request, ORIGINAL_NAME))?.id ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);
    commandId = (await findCommand(context.request, ORIGINAL_NAME))!.id;
  });

  await slowStep('search narrows the list and the saved command executes in the live SSH terminal', async () => {
    const search = quickView.getByTestId('quick-command-search');
    await search.fill('Managed Quick Command');
    const row = quickView.locator(`[data-command-id="${commandId}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('.quick-command-row-actions, .row-action')).toHaveCount(0);
    await row.click({ button: 'right' });
    const contextMenu = page.getByRole('menu').filter({ visible: true }).first();
    await expect(contextMenu).toBeVisible();
    await expect(contextMenu.getByText('Copy', { exact: true })).toBeVisible();
    await expect(contextMenu.getByText('Edit', { exact: true })).toBeVisible();
    await expect(contextMenu.getByText('Delete', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(contextMenu).toBeHidden();
    const before = markerCount(await terminalRows.innerText(), 'QUICK_MANAGED_V1');
    await row.getByTestId('quick-command-execute').click();
    await expect
      .poll(async () => markerCount(await terminalRows.innerText(), 'QUICK_MANAGED_V1'), { timeout: 15_000 })
      .toBeGreaterThan(before);
    await expect
      .poll(async () => Number((await findCommand(context.request, ORIGINAL_NAME))?.usageCount ?? 0))
      .toBeGreaterThanOrEqual(1);
  });

  await step('edit updates both the name and command body', async () => {
    const row = quickView.locator(`[data-command-id="${commandId}"]`);
    await row.click({ button: 'right' });
    const menu = page.getByRole('menu').filter({ visible: true }).first();
    await expect(menu).toBeVisible();
    await menu.getByText('Edit', { exact: true }).click();

    const form = page.getByTestId('quick-command-form');
    await expect(form.getByTestId('quick-command-name')).toHaveValue(ORIGINAL_NAME);
    const reopenedDialog = page.getByRole('dialog', { name: 'Edit Quick Command', exact: true });
    const reopenedBox = await reopenedDialog.boundingBox();
    expect(reopenedBox).toBeTruthy();
    expect(defaultDialogSize).toBeTruthy();
    expect(Math.abs(reopenedBox!.width - defaultDialogSize!.width)).toBeLessThan(2);
    expect(Math.abs(reopenedBox!.height - defaultDialogSize!.height)).toBeLessThan(2);
    await form.getByTestId('quick-command-name').fill(EDITED_NAME);
    await form.getByTestId('quick-command-command').fill("printf 'QUICK_MANAGED_V2\\n'");
    await form.getByTestId('quick-command-submit').click();
    await expect(form).toBeHidden({ timeout: 15_000 });

    await expect
      .poll(async () => (await findCommand(context.request, EDITED_NAME))?.command ?? '', { timeout: 15_000 })
      .toContain('QUICK_MANAGED_V2');
  });

  await slowStep('edited command executes and delete removes it from UI and persistence', async () => {
    const search = quickView.getByTestId('quick-command-search');
    await search.fill('Edited');
    const row = quickView.locator(`[data-command-id="${commandId}"]`);
    await expect(row).toBeVisible();
    await row.getByTestId('quick-command-execute').click();
    await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 }).toContain('QUICK_MANAGED_V2');
    await captureQuickCommandsEvidence(page, testInfo, 'after');

    await row.click({ button: 'right' });
    const menu = page.getByRole('menu').filter({ visible: true }).first();
    await menu.getByText('Delete', { exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Please confirm' });
    await expect(confirm).toContainText(EDITED_NAME);
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => await findCommand(context.request, EDITED_NAME)).toBeUndefined();
  });
});
