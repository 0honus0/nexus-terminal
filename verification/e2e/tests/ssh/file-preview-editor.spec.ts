import { expect, test, type Page } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step, slowStep } from '../../support/steps';

const row = (page: Page, filename: string) => fileManagerRow(page, filename);

async function closePreview(page: Page, filename: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: filename });
  await dialog.getByRole('button', { name: 'Close preview' }).click();
  await expect(dialog).toBeHidden();
}

test('file previews and text editor protect historical file-opening regressions', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await step('extensionless text opens with its real remote content', async () => {
    await row(page, 'plainfile').dblclick();
    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor).toContainText('plainfile');
    const viewLines = editor.locator('.monaco-editor .view-lines');
    await expect.poll(async () => await viewLines.innerText()).toContain('plain-no-extension');
  });

  await step('editor popup resize keeps Monaco visible and usable', async () => {
    const editor = page.getByTestId('file-editor-overlay');
    const popup = editor.locator('.editor-popup');
    const before = await popup.boundingBox();
    expect(before).toBeTruthy();
    const handle = editor.getByTestId('file-editor-resize-handle');
    const handleBox = await handle.boundingBox();
    expect(handleBox).toBeTruthy();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 120, handleBox!.y + 90, { steps: 5 });
    await page.mouse.up();
    const after = await popup.boundingBox();
    expect(after).toBeTruthy();
    expect(after!.width).toBeGreaterThan(before!.width + 50);
    expect(after!.height).toBeGreaterThan(before!.height + 40);
    await expect(editor.locator('.monaco-editor')).toBeVisible();
  });

  await slowStep('editing and saving an extensionless file persists over SFTP', async () => {
    const editor = page.getByTestId('file-editor-overlay');
    const monaco = editor.getByTestId('monaco-editor');
    await monaco.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText('plain-updated-through-editor\n');
    await expect.poll(async () => await editor.locator('.monaco-editor .view-lines').innerText())
      .toContain('plain-updated-through-editor');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await editor.getByTestId('file-editor-close').click();
    await expect(editor).toBeHidden();

    await row(page, 'plainfile').dblclick();
    const reopened = page.getByTestId('file-editor-overlay');
    await expect.poll(async () => await reopened.locator('.monaco-editor .view-lines').innerText())
      .toContain('plain-updated-through-editor');
    await reopened.getByTestId('file-editor-close').click();
  });

  await slowStep('Unicode image filename streams and renders inline', async () => {
    const filename = '预览-测试.png';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog).toBeVisible();
    const image = dialog.locator('img');
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    const src = await image.getAttribute('src');
    expect(src).toContain(encodeURIComponent(filename));
    await closePreview(page, filename);
  });

  await slowStep('Markdown preview renders parsed content and exposes text editing', async () => {
    const filename = 'README-e2e.md';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
    await expect(dialog.locator('strong')).toHaveText('preview-ok');
    await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible();
    await expect.poll(async () => (await editor.locator('.monaco-editor .view-lines').innerText()).replace(/\u00a0/g, ' '))
      .toContain('Nexus Markdown E2E');
    await editor.getByTestId('file-editor-close').click();
  });

  await slowStep('XLSX preview parses workbook cells', async () => {
    const filename = 'preview.xlsx';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText('Nexus XLSX E2E', { exact: true })).toBeVisible();
    await expect(dialog.getByText('2026', { exact: true })).toBeVisible();
    await closePreview(page, filename);
  });

  await step('stale symlink reports its own load error instead of reusing stale preview data', async () => {
    await expect(row(page, 'stale-image-link.png')).toBeVisible();
    await row(page, 'stale-image-link.png').dblclick();
    await expect(page.getByText('Failed to read file', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('file-editor-overlay')).toHaveCount(0);
    await expect(row(page, 'seed.txt')).toBeVisible();
  });
});
