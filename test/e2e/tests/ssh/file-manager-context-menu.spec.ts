import { expect, test, type Locator, type Page } from '../../support/fixtures';
import { readFile } from 'node:fs/promises';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
  E2E_SSH,
} from '../../support/ssh';
import { step, slowStep } from '../../support/steps';

const row = (page: Page, filename: string): Locator => fileManagerRow(page, filename);
const menu = (page: Page): Locator => page.getByTestId('file-manager-context-menu');

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
  await activeFileManagerList(page).dispatchEvent('contextmenu', {
    clientX: 120,
    clientY: 120,
  });
  await expect(menu(page)).toBeVisible();
}

async function confirmAction(page: Page, actionType: string, value?: string): Promise<void> {
  const modal = page.getByTestId('file-manager-action-modal');
  await expect(modal).toHaveAttribute('data-action-type', actionType);
  if (value !== undefined) {
    await modal.locator(`#fileManagerActionInput-${actionType}`).fill(value);
  }
  await modal.getByTestId('file-manager-action-confirm').click();
}

async function goIntoFolder(page: Page, folder: string): Promise<void> {
  await row(page, folder).click();
  await expect(row(page, '..')).toBeVisible();
}

async function goToParent(page: Page): Promise<void> {
  await row(page, '..').click();
  await expect(row(page, 'seed.txt')).toBeVisible();
}

async function compressFromMenu(page: Page, source: string, submenuLabel: string, archiveName: string): Promise<void> {
  await rightClickRow(page, source);
  const compress = menu(page).locator('li').filter({ hasText: /^Compress/ }).first();
  await expect(compress).toBeVisible();
  await compress.hover();
  await page.getByText(submenuLabel, { exact: true }).click();
  await expect(row(page, archiveName)).toBeVisible({ timeout: 30_000 });
}

test('keeps the compress submenu inside the viewport in a narrow right sidebar', async ({ page, context }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  const originalSidebarResponse = await context.request.get('/api/v1/settings/sidebar');
  expect(originalSidebarResponse.ok()).toBeTruthy();
  const originalSidebar = await originalSidebarResponse.json() as { left: string[]; right: string[] };

  try {
    const sidebarResponse = await context.request.put('/api/v1/settings/sidebar', {
      data: { left: originalSidebar.left, right: ['fileManager'] },
    });
    expect(sidebarResponse.ok()).toBeTruthy();

    await connectTestSshFromConnectionsPage(page, connectionId);
    await page.getByTestId('sidebar-pane-fileManager').click();

    const rightSidebar = page.getByTestId('right-sidebar-panel');
    await expect(rightSidebar).toBeVisible();
    await rightSidebar.evaluate((element) => {
      (element as HTMLElement).style.width = '220px';
    });

    const sidebarList = rightSidebar.getByTestId('file-manager-list');
    await expect(sidebarList).toBeVisible();
    const target = sidebarList.locator('tr[data-filename="archive-source.txt"]');
    await expect(target).toBeVisible({ timeout: 20_000 });

    const targetBox = await target.boundingBox();
    const viewport = page.viewportSize();
    expect(targetBox).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(targetBox!.x).toBeGreaterThan(viewport!.width - 230);

    await target.click({
      button: 'right',
      position: { x: Math.max(1, targetBox!.width - 4), y: Math.round(targetBox!.height / 2) },
    });
    await expect(menu(page)).toBeVisible();

    const compress = menu(page).locator('li').filter({ hasText: /^Compress/ }).first();
    await expect(compress).toBeVisible();
    await compress.hover();

    const submenu = page.getByTestId('file-manager-context-submenu');
    await expect(submenu).toBeVisible();
    await expect(submenu).toHaveAttribute('data-side', 'left');

    const submenuBox = await submenu.boundingBox();
    expect(submenuBox).toBeTruthy();
    expect(submenuBox!.x).toBeGreaterThanOrEqual(0);
    expect(submenuBox!.x + submenuBox!.width).toBeLessThanOrEqual(viewport!.width);
  } finally {
    await context.request.put('/api/v1/settings/sidebar', { data: originalSidebar });
  }
});

test('verifies file manager right-click actions over real SFTP', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await step('Open as text reads the remote file', async () => {
    await rightClickRow(page, 'README-e2e.md');
    await clickMenuItem(page, 'Open as text');
    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('README-e2e.md');
    await expect(editor.locator('.view-lines')).toContainText('Nexus Markdown E2E', { timeout: 20_000 });
    await expect(editor).not.toContainText('Failed to');
    await editor.getByTestId('file-editor-close').click();
    await expect(editor).toBeHidden();
  });

  await step('Download streams a remote file through the browser', async () => {
    await rightClickRow(page, 'seed.txt');
    const ticketPromise = page.waitForResponse((response) => (
      response.url().endsWith('/api/v1/sftp/download-ticket') && response.request().method() === 'POST'
    ));
    const downloadPromise = page.waitForEvent('download');
    await clickMenuItem(page, 'Download');
    expect((await ticketPromise).status()).toBe(201);
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('seed.txt');
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    expect(await readFile(downloadPath!, 'utf8')).toBe('nexus-e2e-seed\n');
  });

  await slowStep('short-lived download tickets support FDM-style HEAD and Range requests without browser cookies', async () => {
    const issued = await context.request.post('/api/v1/sftp/download-ticket', {
      data: {
        connectionId,
        remotePath: '/seed.txt',
      },
    });
    expect(issued.status()).toBe(201);
    const ticket = await issued.json() as { url: string; expiresInSeconds: number };
    expect(ticket.expiresInSeconds).toBe(300);
    expect(ticket.url).toMatch(/^\/api\/v1\/sftp\/download\?ticket=/);

    const url = new URL(ticket.url, 'http://127.0.0.1:4173').toString();
    const ownerHeaders = { 'X-Forwarded-For': '203.0.113.10' };
    const head = await fetch(url, { method: 'HEAD', headers: ownerHeaders });
    expect(head.status).toBe(200);
    expect(head.headers.get('accept-ranges')).toBe('bytes');
    expect(Number(head.headers.get('content-length'))).toBe(Buffer.byteLength('nexus-e2e-seed\n'));

    const firstRange = await fetch(url, {
      headers: { ...ownerHeaders, Range: 'bytes=0-4' },
    });
    expect(firstRange.status).toBe(206);
    expect(firstRange.headers.get('content-range')).toBe(`bytes 0-4/${Buffer.byteLength('nexus-e2e-seed\n')}`);
    expect(Buffer.from(await firstRange.arrayBuffer()).toString('utf8')).toBe('nexus');

    const competingClient = await fetch(url, {
      headers: { 'X-Forwarded-For': '198.51.100.20', Range: 'bytes=5-9' },
    });
    expect(competingClient.status).toBe(423);

    const remainder = await fetch(url, {
      headers: { ...ownerHeaders, Range: 'bytes=5-' },
    });
    expect(remainder.status).toBe(206);
    expect(Buffer.from(await remainder.arrayBuffer()).toString('utf8')).toBe('-e2e-seed\n');

    const destroyed = await fetch(url, { method: 'HEAD', headers: ownerHeaders });
    expect(destroyed.status).toBe(410);
  });

  await slowStep('Upload writes exact bytes over SFTP and the uploaded file downloads intact', async () => {
    const filename = 'uploaded-e2e.txt';
    const payload = Buffer.from('UPLOAD_BYTES_E2E\nline-2-中文\n', 'utf8');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('file-manager-modal').getByTestId('file-upload-button').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name: filename, mimeType: 'text/plain', buffer: payload });
    await expect(row(page, filename)).toBeVisible({ timeout: 30_000 });

    const remoteRead = await fetch(`${E2E_SSH.controlUrl}/read?name=${encodeURIComponent(filename)}`);
    expect(remoteRead.ok).toBeTruthy();
    const remoteBody = await remoteRead.json() as { base64: string };
    expect(Buffer.from(remoteBody.base64, 'base64')).toEqual(payload);

    await rightClickRow(page, filename);
    const downloadPromise = page.waitForEvent('download');
    await clickMenuItem(page, 'Download');
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    expect(await readFile(downloadPath!)).toEqual(payload);
  });

  await step('Copy Path writes the remote path to clipboard', async () => {
    await rightClickRow(page, 'seed.txt');
    await clickMenuItem(page, 'Copy Path');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/seed\.txt$/);
  });

  await step('New File creates a real SFTP file', async () => {
    await rightClickRow(page, 'seed.txt');
    await clickMenuItem(page, 'New File');
    await confirmAction(page, 'newFile', 'created-by-menu.txt');
    await expect(row(page, 'created-by-menu.txt')).toBeVisible();
  });

  await step('New Folder creates a real SFTP directory', async () => {
    await rightClickRow(page, 'seed.txt');
    await clickMenuItem(page, 'New Folder');
    await confirmAction(page, 'newFolder', 'created-folder');
    await expect(row(page, 'created-folder')).toBeVisible();
  });

  await step('Rename changes the remote filename', async () => {
    await rightClickRow(page, 'created-by-menu.txt');
    await clickMenuItem(page, 'Rename');
    await confirmAction(page, 'rename', 'renamed-by-menu.txt');
    await expect(row(page, 'renamed-by-menu.txt')).toBeVisible();
    await expect(row(page, 'created-by-menu.txt')).toHaveCount(0);
  });

  await step('Change Permissions changes the remote mode', async () => {
    await rightClickRow(page, 'renamed-by-menu.txt');
    await clickMenuItem(page, 'Change Permissions');
    await confirmAction(page, 'chmod', '600');
    await rightClickRow(page, 'renamed-by-menu.txt');
    await clickMenuItem(page, 'Change Permissions');
    const modal = page.getByTestId('file-manager-action-modal');
    await expect(modal.locator('#fileManagerActionInput-chmod')).toHaveValue('600');
    await page.keyboard.press('Escape');
  });

  await step('Copy and Paste copies a remote file into another directory', async () => {
    await rightClickRow(page, 'copy-source.txt');
    await clickMenuItem(page, 'Copy');
    await goIntoFolder(page, 'folder-seed');
    await openCurrentDirectoryContextMenu(page);
    await clickMenuItem(page, 'Paste');
    await expect(row(page, 'copy-source.txt')).toBeVisible({ timeout: 20_000 });
    await goToParent(page);
    await expect(row(page, 'copy-source.txt')).toBeVisible();
  });

  await step('Cut and Paste moves a remote file into another directory', async () => {
    await rightClickRow(page, 'move-source.txt');
    await clickMenuItem(page, 'Cut');
    await goIntoFolder(page, 'folder-seed');
    await openCurrentDirectoryContextMenu(page);
    await clickMenuItem(page, 'Paste');
    await expect(row(page, 'move-source.txt')).toBeVisible({ timeout: 20_000 });
    await goToParent(page);
    await expect(row(page, 'move-source.txt')).toHaveCount(0);
  });

  await slowStep('Upload keeps a multi-block transfer alive and writes the full remote file', async () => {
    const filename = 'uploaded-large.bin';
    const size = 3 * 1024 * 1024 + 123;
    await rightClickRow(page, 'seed.txt');
    const chooserPromise = page.waitForEvent('filechooser');
    await clickMenuItem(page, 'Upload');
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: filename,
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(size, 0x5a),
    });
    await expect(row(page, filename)).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const response = await fetch(`${E2E_SSH.controlUrl}/stat?name=${encodeURIComponent(filename)}`);
      if (!response.ok) return -1;
      return Number((await response.json() as { size: number }).size);
    }, { timeout: 30_000 }).toBe(size);
  });

  await step('Refresh reloads changes made outside the UI', async () => {
    const fixtureName = 'external-refresh.txt';
    await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(fixtureName)}`, { method: 'POST' });
    await expect(row(page, fixtureName)).toHaveCount(0);
    await rightClickRow(page, 'seed.txt');
    await clickMenuItem(page, 'Refresh');
    await expect(row(page, fixtureName)).toBeVisible({ timeout: 20_000 });
  });

  await slowStep('Download Folder streams a ZIP archive', async () => {
    await rightClickRow(page, 'folder-seed');
    const downloadPromise = page.waitForEvent('download');
    await clickMenuItem(page, 'Download Folder');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('folder-seed.zip');
  });

  await slowStep('Compress to zip creates a remote archive', async () => {
    await compressFromMenu(page, 'archive-source.txt', 'Compress to zip', 'archive-source.zip');
  });

  await slowStep('Compress to tar.gz creates a remote archive', async () => {
    await compressFromMenu(page, 'archive-source.txt', 'Compress to tar.gz', 'archive-source.tar.gz');
  });

  await slowStep('Compress to tar.bz2 creates a remote archive', async () => {
    await compressFromMenu(page, 'archive-source.txt', 'Compress to tar.bz2', 'archive-source.tar.bz2');
  });

  await step('Delete removes a real remote file', async () => {
    await rightClickRow(page, 'archive-source.txt');
    await clickMenuItem(page, 'Delete');
    await confirmAction(page, 'delete');
    await expect(row(page, 'archive-source.txt')).toHaveCount(0);
  });

  await slowStep('Decompress restores files from the remote ZIP archive', async () => {
    await rightClickRow(page, 'archive-source.zip');
    await clickMenuItem(page, 'Decompress');
    await expect(row(page, 'archive-source.txt')).toBeVisible({ timeout: 30_000 });
  });

  await slowStep('Password-protected ZIP prompts only when decompression discovers encryption', async () => {
    const specialPassword = "Nexus !@#$%^&*()_+-=[]{};:'\",.<>/?\\|`~";

    await rightClickRow(page, 'archive-source.zip');
    await clickMenuItem(page, 'Delete');
    await confirmAction(page, 'delete');
    await expect(row(page, 'archive-source.zip')).toHaveCount(0);

    await rightClickRow(page, 'archive-source.txt');
    const compress = menu(page).locator('li').filter({ hasText: /^Compress/ }).first();
    await expect(compress).toBeVisible();
    await compress.hover();
    await page.getByText('Compress to zip with password...', { exact: true }).click();

    const passwordModal = page.getByTestId('archive-password-modal');
    const passwordInput = passwordModal.getByTestId('archive-password-input');
    const passwordConfirm = passwordModal.getByTestId('archive-password-confirm');
    const submit = passwordModal.getByTestId('archive-password-submit');
    await expect(passwordModal).toHaveAttribute('data-mode', 'compress');

    await passwordInput.fill('x'.repeat(129));
    await passwordConfirm.fill('x'.repeat(129));
    await expect(passwordModal.getByTestId('archive-password-error')).toContainText('128');
    await expect(submit).toBeDisabled();

    await passwordInput.fill('x'.repeat(128));
    await passwordConfirm.fill('x'.repeat(128));
    await expect(submit).toBeEnabled();

    await passwordInput.fill(specialPassword);
    await passwordConfirm.fill(specialPassword);
    await submit.click();
    await expect(passwordModal).toBeHidden();
    await expect(row(page, 'archive-source.zip')).toBeVisible({ timeout: 30_000 });

    await rightClickRow(page, 'archive-source.txt');
    await clickMenuItem(page, 'Delete');
    await confirmAction(page, 'delete');
    await expect(row(page, 'archive-source.txt')).toHaveCount(0);

    await rightClickRow(page, 'archive-source.zip');
    await clickMenuItem(page, 'Decompress');
    await expect(passwordModal).toBeVisible({ timeout: 30_000 });
    await expect(passwordModal).toHaveAttribute('data-mode', 'decompress');

    await passwordInput.fill('wrong-password');
    await submit.click();
    await expect(passwordModal).toBeVisible({ timeout: 30_000 });
    await expect(passwordModal.getByTestId('archive-password-error')).toContainText('Incorrect zip password');

    await passwordInput.fill(specialPassword);
    await submit.click();
    await expect(passwordModal).toBeHidden();
    await expect(row(page, 'archive-source.txt')).toBeVisible({ timeout: 30_000 });
  });

  await step('Send to opens the transfer workflow with the selected file', async () => {
    await rightClickRow(page, 'seed.txt');
    await clickMenuItem(page, 'Send to...');
    const sendFilesHeading = page.getByRole('heading', { name: 'Send Files' });
    await expect(sendFilesHeading).toBeVisible();
    const sendFilesModal = sendFilesHeading.locator('..').locator('..');
    await expect(sendFilesModal.locator('li[title="/seed.txt"]')).toBeVisible();
    await sendFilesModal.getByRole('button', { name: 'Close modal' }).click();
  });
});
