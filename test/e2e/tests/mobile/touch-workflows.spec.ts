import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

async function connectMobileSsh(page: Parameters<typeof connectTestSshFromConnectionsPage>[0], request: Parameters<typeof loginAsInitialAdmin>[0]): Promise<void> {
  await loginAsInitialAdmin(request);
  await configureSshE2eSettings(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 20_000 });
}

test('mobile command bar opens the touch-only quick commands surface', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);

  await step('mobile-only quick commands button opens the embedded command list', async () => {
    const commandBar = page.getByTestId('command-input-bar');
    const quickCommandsButton = commandBar.locator('button:has(i.fa-bolt)');
    await expect(quickCommandsButton).toBeVisible();
    await quickCommandsButton.click();

    const quickCommands = page.getByTestId('quick-commands-view');
    await expect(quickCommands).toBeVisible();
    await expect(quickCommands.getByTestId('quick-command-add')).toBeVisible();
    await expect(quickCommands.locator('[data-testid="quick-command-search-toggle"], [data-testid="quick-command-search"]').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(quickCommands).toBeHidden();
  });
});

test('mobile virtual keyboard Ctrl modifier reaches the live SSH input stream', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);

  const commandBar = page.getByTestId('command-input-bar');
  const commandInput = page.getByTestId('command-input');
  const terminalRows = page.getByTestId('terminal').locator('.xterm-rows');

  await step('start a one-byte remote reader, then open the compact mobile keyboard and arm Ctrl', async () => {
    await commandInput.fill("byte=$(dd bs=1 count=1 2>/dev/null | od -An -t u1); printf 'CTRL_BYTE=%s\\n' \"$byte\"");
    await commandInput.press('Enter');

    const keyboardButton = commandBar.locator('button:has(i.fa-keyboard)');
    await expect(keyboardButton).toBeVisible();
    await keyboardButton.click();

    const keyboard = page.locator('.mobile-virtual-keyboard.virtual-keyboard-bar');
    await expect(keyboard).toBeVisible();
    const ctrl = keyboard.getByRole('button', { name: 'Ctrl', exact: true });
    await ctrl.click();
    await expect(ctrl).toHaveClass(/bg-primary/);
  });

  await slowStep('Ctrl+C delivers ASCII ETX and consumes the one-shot modifier', async () => {
    await commandInput.press('c');

    const ctrl = page.locator('.mobile-virtual-keyboard.virtual-keyboard-bar').getByRole('button', { name: 'Ctrl', exact: true });
    await expect(ctrl).not.toHaveClass(/bg-primary/);
    await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 }).toMatch(/CTRL_BYTE=\s*3/);
  });
});

test('mobile file manager navigates directories with a single tap', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);

  await slowStep('single tap enters a folder without requiring a desktop double click', async () => {
    await fileManagerRow(page, 'folder-seed').click();
    await expect(fileManagerRow(page, 'nested.txt')).toBeVisible({ timeout: 15_000 });
    await expect(fileManagerRow(page, '..')).toBeVisible();
  });

  await step('parent row returns to the original directory on a single tap', async () => {
    await fileManagerRow(page, '..').click();
    await expect(fileManagerRow(page, 'seed.txt')).toBeVisible({ timeout: 15_000 });
  });
});

test('mobile file manager multi-select prevents accidental opens and single tap uses CodeMirror editor', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);

  const fileManagerModal = page.getByTestId('file-manager-modal');
  const seed = fileManagerRow(page, 'seed.txt');
  const archive = fileManagerRow(page, 'archive-source.txt');

  await step('multi-select turns file taps into selections', async () => {
    const enterMultiSelect = fileManagerModal.getByTitle('Enter Multi-Select Mode');
    await expect(enterMultiSelect).toBeVisible();
    await enterMultiSelect.click();

    await seed.click();
    await archive.click();
    await expect(seed).toHaveClass(/bg-primary/);
    await expect(archive).toHaveClass(/bg-primary/);
    await expect(page.getByTestId('file-editor-overlay')).toHaveCount(0);

    const exitMultiSelect = fileManagerModal.getByTitle('Exit Multi-Select Mode');
    await expect(exitMultiSelect).toBeVisible();
    await exitMultiSelect.click();
    await expect(seed).not.toHaveClass(/bg-primary/);
    await expect(archive).not.toHaveClass(/bg-primary/);
  });

  await slowStep('single tap opens the full-screen mobile CodeMirror editor rather than Monaco', async () => {
    await fileManagerRow(page, 'plainfile').click();
    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor.locator('.codemirror-mobile-editor-container')).toBeVisible();
    await expect(editor.locator('.monaco-editor')).toHaveCount(0);
    await expect(editor.getByTitle('Search')).toBeVisible();
    await expect.poll(async () => editor.locator('.cm-content').innerText(), { timeout: 15_000 }).toContain('plain-no-extension');

    const viewport = page.viewportSize();
    const popupBox = await editor.locator('.editor-popup').boundingBox();
    expect(viewport).toBeTruthy();
    expect(popupBox).toBeTruthy();
    expect(popupBox!.width).toBeGreaterThanOrEqual(viewport!.width - 2);
    expect(popupBox!.height).toBeGreaterThanOrEqual(viewport!.height - 2);
  });
});
