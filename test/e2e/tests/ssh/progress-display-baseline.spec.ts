import { expect, test, type BrowserContext, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  configureSshE2eSettings,
  closeConnectedFileManager,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  openDesktopProgressDisplay,
  reopenConnectedFileManager,
  resetTestSshFilesystem,
  E2E_SSH,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';
import {
  closeProgressDisplay,
  hideVisibleProgressCenter,
  visibleProgressCenter,
  visibleProgressTask,
} from './progress-display.helpers';

const row = (page: Page, filename: string): Locator => fileManagerRow(page, filename);
const menu = (page: Page): Locator => page.getByTestId('file-manager-context-menu');

async function openFileManager(page: Page, context: BrowserContext): Promise<void> {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);
}

async function rightClickRow(page: Page, filename: string): Promise<void> {
  const target = row(page, filename);
  await expect(target).toBeVisible();
  await target.click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
}

async function clickMenuItem(page: Page, label: string): Promise<void> {
  await menu(page).getByText(label, { exact: true }).first().click();
}

async function openCurrentDirectoryContextMenu(page: Page): Promise<void> {
  await activeFileManagerList(page).dispatchEvent('contextmenu', { clientX: 120, clientY: 120 });
  await expect(menu(page)).toBeVisible();
}

async function goIntoFolder(page: Page, folder: string): Promise<void> {
  const target = row(page, folder);
  const targetPath = await target.getAttribute('data-file-path');
  expect(targetPath).toBeTruthy();
  await target.click();
  await expect(page.getByTestId('file-manager-modal').getByTestId('file-manager-path-input')).toHaveValue(targetPath!);
}

async function refreshFileManager(page: Page): Promise<void> {
  await openCurrentDirectoryContextMenu(page);
  await clickMenuItem(page, 'Refresh');
}

async function openProgressDisplayAndRestorePopup(page: Page, popup: Locator, taskText: string): Promise<void> {
  const modal = await openDesktopProgressDisplay(page);
  const source = modal.getByTestId('hidden-progress-source').filter({ hasText: taskText });
  const task = source.getByTestId('hidden-progress-task').filter({ hasText: taskText });
  await expect(source).toBeVisible();
  await expect(task).toBeVisible();
  await expect(task.getByRole('progressbar')).toBeVisible();
  await source.getByTestId('hidden-progress-restore').click();
  await expect(modal).toBeHidden();
  await expect(popup).toBeVisible();
  await hideVisibleProgressCenter(page);
  await reopenConnectedFileManager(page);
}

async function expectPopupBelowApplicationModals(popup: Locator): Promise<void> {
  await expect
    .poll(() =>
      popup.evaluate((element) => {
        const zIndex = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
        return Number.isFinite(zIndex) ? zIndex : 0;
      }),
    )
    .toBeLessThan(50);
}

test('desktop Progress Display floats above the workspace without resizing the terminal', async ({ page, context }) => {
  let holdNextServerRefresh = false;
  let backgroundRefreshStarted: (() => void) | undefined;
  let releaseBackgroundRefresh: (() => void) | undefined;
  const nextBackgroundRefresh = new Promise<void>((resolve) => {
    backgroundRefreshStarted = resolve;
  });
  await page.route('**/api/v1/transfers/status', async (route) => {
    if (holdNextServerRefresh) {
      holdNextServerRefresh = false;
      backgroundRefreshStarted?.();
      await new Promise<void>((resolve) => {
        releaseBackgroundRefresh = resolve;
      });
    }
    await route.continue();
  });

  await openFileManager(page, context);
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=3000`, { method: 'POST' });
  try {
    await rightClickRow(page, 'copy-source.txt');
    await clickMenuItem(page, 'Copy');
    await goIntoFolder(page, 'folder-seed');
    await openCurrentDirectoryContextMenu(page);
    await clickMenuItem(page, 'Paste');
    await expect(visibleProgressCenter(page)).toBeVisible({ timeout: 10_000 });
    await closeConnectedFileManager(page);
    await hideVisibleProgressCenter(page);

    const terminal = page.getByTestId('terminal');
    await expect(terminal).toBeVisible();
    const terminalRect = () =>
      terminal.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
    const before = await terminalRect();

    let display = await openDesktopProgressDisplay(page);
    const after = await terminalRect();
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);

    await step('desktop Progress Display drags freely and restores its last position', async () => {
      const dialog = page.getByTestId('progress-display-dialog');
      const handle = display.getByTestId('progress-display-drag-handle');
      const handleBox = await handle.boundingBox();
      const beforeDrag = await dialog.boundingBox();
      expect(handleBox).toBeTruthy();
      expect(beforeDrag).toBeTruthy();

      await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 70, handleBox!.y + handleBox!.height / 2 + 45, {
        steps: 8,
      });
      await page.mouse.up();

      const moved = await dialog.boundingBox();
      expect(moved).toBeTruthy();
      expect(Math.abs(moved!.x - beforeDrag!.x)).toBeGreaterThan(30);
      expect(Math.abs(moved!.y - beforeDrag!.y)).toBeGreaterThan(20);

      await closeProgressDisplay(display);
      display = await openDesktopProgressDisplay(page);
      const restored = await page.getByTestId('progress-display-dialog').boundingBox();
      expect(restored).toBeTruthy();
      expect(Math.abs(restored!.x - moved!.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(restored!.y - moved!.y)).toBeLessThanOrEqual(2);
    });

    await step(
      'background server-transfer polling does not replace the empty state with a loading screen',
      async () => {
        await expect(display.getByText('There are no active transfer tasks currently.', { exact: true })).toBeVisible();
        holdNextServerRefresh = true;
        await nextBackgroundRefresh;
        await expect(display.getByText('Loading transfer tasks...', { exact: true })).toBeHidden();
        await expect(display.getByText('There are no active transfer tasks currently.', { exact: true })).toBeVisible();
        releaseBackgroundRefresh?.();
        releaseBackgroundRefresh = undefined;
      },
    );

    await closeProgressDisplay(display);
  } finally {
    releaseBackgroundRefresh?.();
    await page.unroute('**/api/v1/transfers/status');
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('existing copy progress popup hides and restores through Progress Display', async ({ page, context }) => {
  await openFileManager(page, context);

  const sourceName = 'baseline-copy-progress.bin';
  await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(sourceName)}&size=${4 * 1024 * 1024}`, {
    method: 'POST',
  });
  await refreshFileManager(page);
  await expect(row(page, sourceName)).toBeVisible();

  // Keep at least one SFTP WRITE round-trip alive while the popup is hidden and
  // Progress Display is opened. A tiny delay is ineffective when writes are
  // pipelined and made this assertion depend on runner timing.
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=3000`, { method: 'POST' });
  try {
    await slowStep('copy creates the existing floating progress popup', async () => {
      await rightClickRow(page, sourceName);
      await clickMenuItem(page, 'Copy');
      await goIntoFolder(page, 'folder-seed');
      await openCurrentDirectoryContextMenu(page);
      await clickMenuItem(page, 'Paste');

      const center = visibleProgressCenter(page);
      await expect(center).toBeVisible({ timeout: 10_000 });
      const task = visibleProgressTask(page, sourceName);
      await expect(task).toContainText('Copy');
      await expectPopupBelowApplicationModals(center);
    });

    await step('the minimize-style action hides the popup and Progress Display restores it', async () => {
      const center = visibleProgressCenter(page);
      await expect(center.getByTestId('transfer-progress-task')).toBeVisible();
      await closeConnectedFileManager(page);
      await hideVisibleProgressCenter(page);
      await openProgressDisplayAndRestorePopup(page, center, sourceName);
    });

    await expect(row(page, sourceName)).toBeVisible({ timeout: 30_000 });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('existing archive progress popup hides and restores through Progress Display', async ({ page, context }) => {
  await openFileManager(page, context);
  await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=1800`, { method: 'POST' });

  try {
    await slowStep('compress creates the existing archive progress popup', async () => {
      await rightClickRow(page, 'archive-source.txt');
      const compress = menu(page).getByRole('button', { name: 'Compress', exact: true });
      await expect(compress).toBeVisible();
      await compress.hover();
      await page
        .getByTestId('file-manager-context-submenu')
        .getByRole('button', { name: 'Compress to zip', exact: true })
        .click();

      const center = visibleProgressCenter(page);
      await expect(center).toBeVisible({ timeout: 10_000 });
      await expect(visibleProgressTask(page, 'archive-source.zip')).toContainText('Compress');
      await expectPopupBelowApplicationModals(center);
    });

    await step('the minimize-style action hides the archive popup and Progress Display restores it', async () => {
      const center = visibleProgressCenter(page);
      await expect(visibleProgressTask(page, 'archive-source.zip')).toBeVisible();
      await closeConnectedFileManager(page);
      await hideVisibleProgressCenter(page);
      await openProgressDisplayAndRestorePopup(page, center, 'archive-source.zip');
    });

    await expect(row(page, 'archive-source.zip')).toBeVisible({ timeout: 30_000 });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
  }
});

test('Send Files restores the server-transfer task cards in Progress Display', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  let releaseInitialTransferList: (() => void) | undefined;
  let markInitialTransferListStarted: (() => void) | undefined;
  const initialTransferListStarted = new Promise<void>((resolve) => {
    markInitialTransferListStarted = resolve;
  });
  let holdInitialTransferList = true;
  await page.route('**/api/v1/transfers/status', async (route) => {
    if (holdInitialTransferList && route.request().method() === 'GET') {
      holdInitialTransferList = false;
      markInitialTransferListStarted?.();
      await new Promise<void>((resolve) => {
        releaseInitialTransferList = resolve;
      });
    }
    await route.continue();
  });
  const sourceConnectionId = await ensureTestSshConnection(context.request);
  const validTargetName = `E2E Send OK ${crypto.randomUUID().slice(0, 8)}`;
  const failedTargetName = `E2E Send Fail ${crypto.randomUUID().slice(0, 8)}`;
  const validTargetResponse = await context.request.post('/api/v1/connections', {
    data: {
      name: validTargetName,
      type: 'SSH',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      authMethod: 'password',
      password: E2E_SSH.password,
    },
  });
  expect(validTargetResponse.status()).toBe(201);
  const validTargetConnectionId = ((await validTargetResponse.json()) as { connection: { id: number } }).connection.id;
  const failedTargetResponse = await context.request.post('/api/v1/connections', {
    data: {
      name: failedTargetName,
      type: 'SSH',
      host: E2E_SSH.host,
      port: 1,
      username: E2E_SSH.username,
      authMethod: 'password',
      password: E2E_SSH.password,
    },
  });
  expect(failedTargetResponse.status()).toBe(201);
  const failedTargetConnectionId = ((await failedTargetResponse.json()) as { connection: { id: number } }).connection
    .id;

  try {
    await connectTestSshFromConnectionsPage(page, sourceConnectionId);
    await openConnectedFileManager(page);

    await step(
      'the restored Send Files form requires an explicit destination and keeps SSH target semantics',
      async () => {
        await rightClickRow(page, 'seed.txt');
        await clickMenuItem(page, 'Send to servers');

        const modal = page.getByRole('dialog', { name: 'Send Files', exact: true });
        await expect(modal).toBeVisible();
        await expect(modal.locator('li[title="/seed.txt"]')).toBeVisible();

        const targetPath = modal.getByLabel('Target Path', { exact: true });
        const sendButton = modal.getByRole('button', { name: 'Send', exact: true });
        await expect(targetPath).toHaveValue('');
        await expect(sendButton).toBeDisabled();

        await modal.getByPlaceholder('Search connections...').fill('E2E Send');
        const validTargetRow = modal.locator('li').filter({ hasText: validTargetName });
        const failedTargetRow = modal.locator('li').filter({ hasText: failedTargetName });
        await expect(validTargetRow).toBeVisible();
        await expect(failedTargetRow).toBeVisible();
        await expect(validTargetRow.locator('i.fa-server')).toBeVisible();
        await validTargetRow.click();
        const visibleGroupCheckbox = modal.locator('input[id^="send-files-group-"]').first();
        await expect(visibleGroupCheckbox).toHaveJSProperty('indeterminate', true);
        await visibleGroupCheckbox.click();
        await expect(validTargetRow.locator('input[type="checkbox"]')).toBeChecked();
        await expect(failedTargetRow.locator('input[type="checkbox"]')).toBeChecked();
        await targetPath.fill('server-transfer-e2e');
        await modal.getByLabel('Transfer Method', { exact: true }).selectOption('rsync');

        // The Workspace transfer catalog can still be loading/refreshed in parallel. That global
        // task-list state must not make this independent form look like it is submitting.
        await initialTransferListStarted;
        await expect(sendButton).toBeEnabled();
        await expect(sendButton.locator('i.fa-spinner')).toBeHidden();
        await sendButton.click();
        await expect(modal).toBeHidden();
        releaseInitialTransferList?.();
        releaseInitialTransferList = undefined;
      },
    );

    await slowStep(
      'the central display exposes a real partial multi-target task, method/error details and final remove action',
      async () => {
        const display = page.getByTestId('progress-display-modal');
        await expect(display).toBeVisible({ timeout: 10_000 });
        await expect(display.getByText('Cross-server transfer tasks', { exact: true })).toBeVisible();

        const taskCard = display.locator('article').filter({ hasText: 'server-transfer-e2e' });
        await expect(taskCard).toBeVisible({ timeout: 10_000 });
        await expect(taskCard).toContainText('Task: E2E SSH (seed.txt -> server-transfer-e2e)');
        await expect(taskCard).toContainText('Created at:');

        const subTasks = taskCard.locator('details');
        await expect(subTasks).toBeVisible();
        await subTasks.locator('summary').click();
        await expect(subTasks).toContainText('Source File: seed.txt');
        await expect(subTasks).toContainText(`Target Connection: ${validTargetName}`);
        await expect(subTasks).toContainText(`Target Connection: ${failedTargetName}`);
        await expect(subTasks).toContainText('Method: rsync', { timeout: 20_000 });
        await expect(taskCard.getByText('Partially Completed', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(subTasks.getByText('Completed', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(subTasks.getByText('Failed', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(subTasks).toContainText('Error:');

        await taskCard.getByRole('button', { name: 'Remove', exact: true }).click();
        await expect(taskCard).toHaveCount(0);
        await closeProgressDisplay(display);
      },
    );

    await step('the successful target contains the transferred file while the source remains intact', async () => {
      await reopenConnectedFileManager(page);
      await refreshFileManager(page);
      await expect(row(page, 'server-transfer-e2e')).toBeVisible({ timeout: 20_000 });
      await goIntoFolder(page, 'server-transfer-e2e');
      await expect(row(page, 'seed.txt')).toBeVisible({ timeout: 20_000 });
    });
  } finally {
    releaseInitialTransferList?.();
    await page.unroute('**/api/v1/transfers/status');
    const tasksResponse = await context.request.get('/api/v1/transfers/status');
    if (tasksResponse.ok()) {
      const tasks = (await tasksResponse.json()) as Array<{
        taskId: string;
        payload?: { sourceConnectionId?: number; connectionIds?: number[] };
      }>;
      for (const task of tasks) {
        if (
          task.payload?.sourceConnectionId === sourceConnectionId &&
          task.payload.connectionIds?.some((id) => [validTargetConnectionId, failedTargetConnectionId].includes(id))
        ) {
          await context.request.delete(`/api/v1/transfers/${encodeURIComponent(task.taskId)}`);
        }
      }
    }
    await context.request.delete(`/api/v1/connections/${validTargetConnectionId}`);
    await context.request.delete(`/api/v1/connections/${failedTargetConnectionId}`);
  }
});
