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
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
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
    const quickDialog = page.getByTestId('quick-commands-dialog');
    await expect(quickCommands).toBeVisible();
    await expect(quickDialog).toHaveAttribute('data-overlay-panel-preset', 'standard-modal');
    await expect(quickCommands.getByTestId('quick-command-add')).toBeVisible();
    await expect(quickCommands.locator('[data-testid="quick-command-search-toggle"], [data-testid="quick-command-search"]').first()).toBeVisible();
    await captureFunctionalScreenshot(page, 'mobile-quick-commands.png');

    await page.keyboard.press('Escape');
    await expect(quickCommands).toBeHidden();
  });
});

test('mobile progress display floats above the workspace and closes from its overlay controls', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);

  const toggle = page.getByTestId('transfer-progress-toggle');
  const overlay = page.getByTestId('progress-display-overlay');
  const display = page.getByTestId('progress-display-modal');
  const dialog = page.getByTestId('progress-display-dialog');

  await step('progress display uses the same standard modal shell as quick commands', async () => {
    const commandBar = page.getByTestId('command-input-bar');
    const quickCommandsButton = commandBar.locator('button:has(i.fa-bolt)');
    await quickCommandsButton.click();
    const quickDialog = page.getByTestId('quick-commands-dialog');
    await expect(quickDialog).toBeVisible();
    const quickShell = await quickDialog.evaluate(element => {
      const style = window.getComputedStyle(element);
      return {
        maxWidth: style.maxWidth,
        maxHeight: style.maxHeight,
        padding: style.padding,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
      };
    });
    await page.keyboard.press('Escape');
    await expect(quickDialog).toBeHidden();

    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(dialog).toBeVisible();
    const progressShell = await dialog.evaluate(element => {
      const style = window.getComputedStyle(element);
      return {
        maxWidth: style.maxWidth,
        maxHeight: style.maxHeight,
        padding: style.padding,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
      };
    });
    expect(progressShell).toEqual(quickShell);
    await display.getByTestId('progress-display-close').click();
    await expect(display).toBeHidden();
  });

  await step('progress display opens as a bounded top-level overlay instead of resizing the terminal', async () => {
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect(display).toBeVisible();
    await expect(display).toHaveAttribute('data-progress-display-placement', 'overlay');
    await expect(dialog).toHaveAttribute('data-overlay-panel-preset', 'standard-modal');
    await expect.poll(() => overlay.evaluate((element) => ({
      position: window.getComputedStyle(element).position,
      zIndex: window.getComputedStyle(element).zIndex,
    }))).toEqual({ position: 'fixed', zIndex: '1100' });

    const viewport = page.viewportSize();
    const dialogBox = await dialog.boundingBox();
    expect(viewport).toBeTruthy();
    expect(dialogBox).toBeTruthy();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(8);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(8);
    expect(dialogBox!.width).toBeLessThanOrEqual(viewport!.width - 16);
    expect(dialogBox!.height).toBeLessThanOrEqual(viewport!.height - 16);
    await expect(page.getByTestId('terminal')).toBeVisible();
    await expect(page.getByTestId('command-input-bar')).toBeVisible();
    await captureFunctionalScreenshot(page, 'mobile-progress-display.png');
  });

  await step('tapping the dimmed blank area closes the progress overlay', async () => {
    await overlay.click({ position: { x: 3, y: 3 } });
    await expect(display).toBeHidden();
  });

  await step('the explicit hide button remains available', async () => {
    await toggle.click();
    await expect(display).toBeVisible();
    await display.getByTestId('transfer-progress-minimize').click();
    await expect(display).toBeHidden();
  });

  await step('the footer close button still closes the overlay', async () => {
    await toggle.click();
    await expect(display).toBeVisible();
    await display.getByTestId('progress-display-close').click();
    await expect(display).toBeHidden();
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
    await captureFunctionalScreenshot(page, 'mobile-file-editor.png');

    const viewport = page.viewportSize();
    const popupBox = await editor.locator('.editor-popup').boundingBox();
    expect(viewport).toBeTruthy();
    expect(popupBox).toBeTruthy();
    expect(popupBox!.width).toBeGreaterThanOrEqual(viewport!.width - 2);
    expect(popupBox!.height).toBeGreaterThanOrEqual(viewport!.height - 2);
  });
});
