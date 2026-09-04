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
  reopenConnectedFileManager,
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

async function confirmAction(
  page: Page,
  actionType: 'file' | 'mkdir' | 'rename' | 'chmod',
  value: string,
): Promise<void> {
  const title =
    actionType === 'file'
      ? 'Create New File'
      : actionType === 'mkdir'
        ? 'Create New Folder'
        : actionType === 'rename'
          ? /Rename /
          : /Change Permissions for /;
  const modal = page.getByRole('dialog', { name: title });
  await expect(modal).toBeVisible();
  await modal.getByLabel('Value', { exact: true }).fill(value);
  await modal.getByRole('button', { name: 'Confirm', exact: true }).click();
}

async function confirmDelete(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Please confirm' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
}

async function goIntoFolder(page: Page, folder: string): Promise<void> {
  const target = row(page, folder);
  const targetPath = await target.getAttribute('data-file-path');
  expect(targetPath).toBeTruthy();
  await target.click();
  await expect(page.getByTestId('file-manager-modal').getByTestId('file-manager-path-input')).toHaveValue(targetPath!);
}

async function goToParent(page: Page): Promise<void> {
  await page.getByTestId('file-manager-modal').getByTitle('Parent Directory', { exact: true }).click();
  await expect(row(page, 'seed.txt')).toBeVisible();
}

async function compressFromMenu(page: Page, source: string, submenuLabel: string, archiveName: string): Promise<void> {
  await rightClickRow(page, source);
  const compress = menu(page).getByRole('button', { name: 'Compress', exact: true });
  await expect(compress).toBeVisible();
  await compress.hover();
  const submenu = page.getByTestId('file-manager-context-submenu');
  await expect(submenu).toBeVisible();
  await submenu.getByRole('button', { name: submenuLabel, exact: true }).click();
  await expect(row(page, archiveName)).toBeVisible({ timeout: 30_000 });
}

test('keeps the compress submenu inside the viewport in a narrow right sidebar', async ({ page, context }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const inlineFileManager = await context.request.put('/api/v1/settings', {
    data: { showPopupFileManager: false },
  });
  expect(inlineFileManager.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  const originalSidebarResponse = await context.request.get('/api/v1/settings/sidebar');
  expect(originalSidebarResponse.ok()).toBeTruthy();
  const originalSidebar = (await originalSidebarResponse.json()) as { left: string[]; right: string[] };

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

    const [targetBox, sidebarBox] = await Promise.all([target.boundingBox(), rightSidebar.boundingBox()]);
    const viewport = page.viewportSize();
    expect(targetBox).toBeTruthy();
    expect(sidebarBox).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(targetBox!.x).toBeLessThan(sidebarBox!.x + sidebarBox!.width);
    expect(targetBox!.x + targetBox!.width).toBeGreaterThan(sidebarBox!.x);
    const visibleTargetRight =
      Math.min(targetBox!.x + targetBox!.width, sidebarBox!.x + sidebarBox!.width) - targetBox!.x;

    await target.click({
      button: 'right',
      position: { x: Math.max(1, visibleTargetRight - 4), y: Math.round(targetBox!.height / 2) },
    });
    await expect(menu(page)).toBeVisible();

    const compress = menu(page).getByRole('button', { name: 'Compress', exact: true });
    await expect(compress).toBeVisible();
    await compress.hover();

    const submenu = page.getByTestId('file-manager-context-submenu');
    await expect(submenu).toBeVisible();
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
    const documentPopup = page.getByTestId('document-popup');
    await expect(documentPopup).toBeVisible();
    await expect(documentPopup).toHaveAttribute('data-document-mode', 'editor');
    const editor = documentPopup.getByTestId('file-editor-view');
    await expect(editor).toContainText('README-e2e.md');
    await expect(editor.locator('.view-lines')).toContainText('Nexus Markdown E2E', { timeout: 20_000 });
    await expect(editor).not.toContainText('Failed to');
    await documentPopup.getByTitle('Close', { exact: true }).first().click();
    await expect(documentPopup).toBeHidden();
    await reopenConnectedFileManager(page);
  });

  await step('Download streams a remote file through the browser', async () => {
    await rightClickRow(page, 'seed.txt');
    const ticketPromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/sftp/download-ticket') && response.request().method() === 'POST',
    );
    const downloadPromise = page.waitForEvent('download');
    await clickMenuItem(page, 'Download');
    expect((await ticketPromise).status()).toBe(201);
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('seed.txt');
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    expect(await readFile(downloadPath!, 'utf8')).toBe('nexus-e2e-seed\n');
  });

  await slowStep(
    'short-lived download tickets support download-manager probes, retries, and Range requests without browser cookies',
    async () => {
      const issued = await context.request.post('/api/v1/sftp/download-ticket', {
        data: {
          connectionId,
          remotePath: '/seed.txt',
        },
      });
      expect(issued.status()).toBe(201);
      const ticket = (await issued.json()) as { url: string; expiresInSeconds: number };
      expect(ticket.expiresInSeconds).toBe(300);
      expect(ticket.url).toMatch(/^\/api\/v1\/sftp\/download\?ticket=/);

      const url = new URL(ticket.url, 'http://127.0.0.1:4173').toString();
      const ownerHeaders = { 'X-Forwarded-For': '203.0.113.10' };
      const head = await fetch(url, { method: 'HEAD', headers: ownerHeaders });
      expect(head.status).toBe(200);
      expect(head.headers.get('accept-ranges')).toBe('bytes');
      expect(Number(head.headers.get('content-length'))).toBe(Buffer.byteLength('nexus-e2e-seed\n'));

      // IDM/FDM may issue a normal GET first to discover Content-Disposition, then
      // reopen the same short-lived URL for the actual transfer. A completed probe
      // must not consume the ticket.
      const probe = await fetch(url, { headers: ownerHeaders });
      expect(probe.status).toBe(200);
      expect(probe.headers.get('content-disposition')).toContain('seed.txt');
      expect(await probe.text()).toBe('nexus-e2e-seed\n');

      const retryAfterProbe = await fetch(url, { headers: ownerHeaders });
      expect(retryAfterProbe.status).toBe(200);
      expect(await retryAfterProbe.text()).toBe('nexus-e2e-seed\n');

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

      const reusableAfterRanges = await fetch(url, { method: 'HEAD', headers: ownerHeaders });
      expect(reusableAfterRanges.status).toBe(200);
    },
  );

  await slowStep('download ticket leases stay bounded by evicting the oldest idle ticket', async () => {
    const urls: string[] = [];
    for (let index = 0; index < 65; index += 1) {
      const issued = await context.request.post('/api/v1/sftp/download-ticket', {
        data: {
          connectionId,
          remotePath: '/seed.txt',
        },
      });
      expect(issued.status()).toBe(201);
      const ticket = (await issued.json()) as { url: string };
      urls.push(new URL(ticket.url, 'http://127.0.0.1:4173').toString());
    }

    const ownerHeaders = { 'X-Forwarded-For': '203.0.113.30' };
    const evicted = await fetch(urls[0], { method: 'HEAD', headers: ownerHeaders });
    expect(evicted.status).toBe(410);

    const newest = await fetch(urls.at(-1)!, { headers: ownerHeaders });
    expect(newest.status).toBe(200);
    expect(await newest.text()).toBe('nexus-e2e-seed\n');
  });

  await slowStep('Upload writes exact bytes over SFTP and the uploaded file downloads intact', async () => {
    const filename = 'uploaded-e2e.txt';
    const payload = Buffer.from('UPLOAD_BYTES_E2E\nline-2-中文\n', 'utf8');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('file-manager-modal').getByTestId('file-upload-button').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name: filename, mimeType: 'text/plain', buffer: payload });
    await expect(row(page, filename)).toBeVisible({ timeout: 30_000 });

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
    await openCurrentDirectoryContextMenu(page);
    await clickMenuItem(page, 'New File');
    await confirmAction(page, 'file', 'created-by-menu.txt');
    await expect(row(page, 'created-by-menu.txt')).toBeVisible();
  });

  await step('New Folder creates a real SFTP directory', async () => {
    await openCurrentDirectoryContextMenu(page);
    await clickMenuItem(page, 'New Folder');
    await confirmAction(page, 'mkdir', 'created-folder');
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
    const modal = page.getByRole('dialog', { name: /Change Permissions for / });
    await expect(modal.getByLabel('Value', { exact: true })).toHaveValue('600');
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
    await openCurrentDirectoryContextMenu(page);
    const chooserPromise = page.waitForEvent('filechooser');
    await clickMenuItem(page, 'Upload');
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: filename,
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(size, 0x5a),
    });
    await expect(row(page, filename)).toBeVisible({ timeout: 30_000 });
    await rightClickRow(page, filename);
    const downloadPromise = page.waitForEvent('download');
    await clickMenuItem(page, 'Download');
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    expect((await readFile(downloadPath!)).byteLength).toBe(size);
  });

  await step('Refresh reloads changes made outside the UI', async () => {
    const fixtureName = 'external-refresh.txt';
    await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(fixtureName)}`, { method: 'POST' });
    await expect(row(page, fixtureName)).toHaveCount(0);
    await openCurrentDirectoryContextMenu(page);
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
    await confirmDelete(page);
    await expect(row(page, 'archive-source.txt')).toHaveCount(0);
  });

  await slowStep('Decompress restores files from the remote ZIP archive', async () => {
    await rightClickRow(page, 'archive-source.zip');
    await clickMenuItem(page, 'Decompress');
    await expect(row(page, 'archive-source.txt')).toBeVisible({ timeout: 30_000 });
  });

  await slowStep('Password-protected ZIP prompts only when decompression discovers encryption', async () => {
    const specialPassword = 'Nexus !@#$%^&*()_+-=[]{};:\'",.<>/?\\|`~';

    await rightClickRow(page, 'archive-source.zip');
    await clickMenuItem(page, 'Delete');
    await confirmDelete(page);
    await expect(row(page, 'archive-source.zip')).toHaveCount(0);

    await rightClickRow(page, 'archive-source.txt');
    const compress = menu(page).getByRole('button', { name: 'Compress', exact: true });
    await expect(compress).toBeVisible();
    await compress.hover();
    const submenu = page.getByTestId('file-manager-context-submenu');
    await submenu.getByRole('button', { name: 'Compress to zip with password...', exact: true }).click();

    let passwordDialog = page.getByRole('dialog', { name: 'Create password-protected zip' });
    let passwordInput = passwordDialog.getByLabel(/^Password\b/);
    let passwordConfirm = passwordDialog.getByLabel(/^Confirm password\b/);
    let submit = passwordDialog.getByRole('button', { name: 'Create zip', exact: true });
    await expect(passwordDialog).toBeVisible();

    await passwordInput.fill('x'.repeat(129));
    await passwordConfirm.fill('x'.repeat(129));
    await expect(passwordDialog.getByRole('alert')).toContainText('128');
    await expect(submit).toBeDisabled();

    await passwordInput.fill('x'.repeat(128));
    await passwordConfirm.fill('x'.repeat(128));
    await expect(submit).toBeEnabled();

    await passwordInput.fill(specialPassword);
    await passwordConfirm.fill(specialPassword);
    await submit.click();
    await expect(passwordDialog).toBeHidden();
    await expect(row(page, 'archive-source.zip')).toBeVisible({ timeout: 30_000 });

    await rightClickRow(page, 'archive-source.txt');
    await clickMenuItem(page, 'Delete');
    await confirmDelete(page);
    await expect(row(page, 'archive-source.txt')).toHaveCount(0);

    await rightClickRow(page, 'archive-source.zip');
    await clickMenuItem(page, 'Decompress');
    passwordDialog = page.getByRole('dialog', { name: 'zip password required' });
    passwordInput = passwordDialog.getByLabel(/^Password\b/);
    submit = passwordDialog.getByRole('button', { name: 'Extract', exact: true });
    await expect(passwordDialog).toBeVisible({ timeout: 30_000 });

    await passwordInput.fill('wrong-password');
    await submit.click();
    await expect(passwordDialog).toBeVisible({ timeout: 30_000 });
    await expect(passwordDialog.getByRole('alert')).toContainText('Incorrect zip password');

    await passwordInput.fill(specialPassword);
    await submit.click();
    await expect(passwordDialog).toBeHidden();
    await expect(row(page, 'archive-source.txt')).toBeVisible({ timeout: 30_000 });
  });

  await step('Send to opens the transfer workflow with the selected file', async () => {
    await rightClickRow(page, 'seed.txt');
    await clickMenuItem(page, 'Send to servers');
    const sendFilesModal = page.getByRole('dialog', { name: 'Send Files', exact: true });
    await expect(sendFilesModal).toBeVisible();
    await expect(sendFilesModal.locator('li[title="/seed.txt"]')).toBeVisible();
    await sendFilesModal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(sendFilesModal).toBeHidden();
  });
});
