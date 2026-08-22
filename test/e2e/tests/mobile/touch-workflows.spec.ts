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

test('remote touch supports switchable direct and touchpad Guacamole input', async ({ page }) => {
  await page.goto('/login');

  const result = await page.evaluate(async () => {
    const modulePath = '/src/foundation/interaction/remoteTouchInput.ts';
    const { attachRemoteTouchInput } = await import(/* @vite-ignore */ modulePath);
    const calls: Array<{
      x: number;
      y: number;
      left: boolean;
      right: boolean;
      up: boolean;
      down: boolean;
      applyDisplayScale: boolean;
    }> = [];
    let cursorShowCount = 0;
    let keyboardTapCount = 0;

    const target = document.createElement('div');
    Object.assign(target.style, {
      position: 'fixed',
      left: '20px',
      top: '30px',
      width: '200px',
      height: '120px',
    });
    document.body.appendChild(target);

    const keyboardSink = document.createElement('textarea');
    keyboardSink.dataset.testid = 'e2e-mobile-keyboard-sink';
    document.body.appendChild(keyboardSink);
    const focusKeyboard = () => {
      keyboardTapCount += 1;
      keyboardSink.focus();
    };

    const fakeClient = {
      getDisplay: () => ({
        showCursor: () => {
          cursorShowCount += 1;
        },
      }),
      sendMouseState: (state, applyDisplayScale = false) => {
        calls.push({
          x: state.x,
          y: state.y,
          left: state.left,
          right: state.right,
          up: state.up,
          down: state.down,
          applyDisplayScale,
        });
      },
    };
    const input = attachRemoteTouchInput(target, fakeClient, 'direct', { onTap: focusKeyboard });

    const touch = (identifier: number, clientX: number, clientY: number, force: number) => new Touch({
      identifier,
      target,
      clientX,
      clientY,
      pageX: clientX,
      pageY: clientY,
      screenX: clientX,
      screenY: clientY,
      radiusX: 8,
      radiusY: 8,
      rotationAngle: 0,
      force,
    });
    const dispatch = (type: 'touchstart' | 'touchmove' | 'touchend', active: Touch[], changed: Touch[]) => {
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: active,
        targetTouches: active,
        changedTouches: changed,
      }));
    };
    const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

    const tapTouch = touch(1, 80, 90, 0.5);
    dispatch('touchstart', [tapTouch], [tapTouch]);
    dispatch('touchend', [], [touch(1, 80, 90, 0)]);
    await wait(300);
    const tapCalls = calls.slice();
    const directTapFocusedKeyboard = document.activeElement === keyboardSink && keyboardTapCount === 1;

    const holdTouch = touch(2, 130, 110, 0.5);
    dispatch('touchstart', [holdTouch], [holdTouch]);
    await wait(550);
    dispatch('touchend', [], [touch(2, 130, 110, 0)]);
    const holdCalls = calls.slice(tapCalls.length);
    const holdSkippedKeyboard = keyboardTapCount === 1;

    const dragCallStart = calls.length;
    const firstDragTap = touch(3, 90, 100, 0.5);
    dispatch('touchstart', [firstDragTap], [firstDragTap]);
    dispatch('touchend', [], [touch(3, 90, 100, 0)]);
    await wait(100);
    const secondDragTouch = touch(4, 90, 100, 0.5);
    dispatch('touchstart', [secondDragTouch], [secondDragTouch]);
    const movedDragTouch = touch(4, 150, 120, 0.5);
    dispatch('touchmove', [movedDragTouch], [movedDragTouch]);
    dispatch('touchend', [], [touch(4, 150, 120, 0)]);
    await wait(300);
    const dragCalls = calls.slice(dragCallStart);
    const dragMoveDidNotAddExtraKeyboard = keyboardTapCount === 2;
    const allCalls = calls.slice();

    const touchActionWhileAttached = target.style.touchAction;
    input.destroy();
    const callCountAfterDestroy = calls.length;

    const ignoredTouch = touch(5, 60, 70, 0.5);
    dispatch('touchstart', [ignoredTouch], [ignoredTouch]);
    dispatch('touchend', [], [touch(5, 60, 70, 0)]);
    await wait(300);
    const stoppedAfterDestroy = calls.length === callCountAfterDestroy;
    const keyboardStoppedAfterDestroy = keyboardTapCount === 2;

    const touchpadCallStart = calls.length;
    const touchpadInput = attachRemoteTouchInput(
      target,
      fakeClient,
      'touchpad',
      { onTap: focusKeyboard },
    );

    const moveStart = touch(6, 70, 70, 0.5);
    dispatch('touchstart', [moveStart], [moveStart]);
    const moveEnd = touch(6, 135, 105, 0.5);
    dispatch('touchmove', [moveEnd], [moveEnd]);
    dispatch('touchend', [], [touch(6, 135, 105, 0)]);

    const touchpadTap = touch(11, 100, 90, 0.5);
    dispatch('touchstart', [touchpadTap], [touchpadTap]);
    dispatch('touchend', [], [touch(11, 100, 90, 0)]);
    const touchpadTapFocusedKeyboard = document.activeElement === keyboardSink && keyboardTapCount === 3;

    const rightTouches = [
      touch(7, 80, 80, 0.5),
      touch(8, 120, 80, 0.5),
    ];
    dispatch('touchstart', rightTouches, rightTouches);
    dispatch('touchend', [], [
      touch(7, 80, 80, 0),
      touch(8, 120, 80, 0),
    ]);
    await wait(300);

    const scrollStart = [
      touch(9, 85, 80, 0.5),
      touch(10, 125, 80, 0.5),
    ];
    dispatch('touchstart', scrollStart, scrollStart);
    const scrollEnd = [
      touch(9, 85, 180, 0.5),
      touch(10, 125, 180, 0.5),
    ];
    dispatch('touchmove', scrollEnd, scrollEnd);
    dispatch('touchend', [], [
      touch(9, 85, 180, 0),
      touch(10, 125, 180, 0),
    ]);
    const touchpadCalls = calls.slice(touchpadCallStart);
    const multiTouchSkippedKeyboard = keyboardTapCount === 3;
    const touchpadMode = touchpadInput.mode;
    touchpadInput.destroy();
    target.remove();
    keyboardSink.remove();

    return {
      directMode: input.mode,
      touchpadMode,
      touchActionWhileAttached,
      touchActionAfterDestroy: target.style.touchAction,
      cursorShowCount,
      allScaled: [...allCalls, ...touchpadCalls].every(call => call.applyDisplayScale),
      tapPressedLeft: tapCalls.some(call => call.left),
      tapReleasedLeft: tapCalls.some(call => !call.left),
      directTapFocusedKeyboard,
      holdSkippedKeyboard,
      dragMoveDidNotAddExtraKeyboard,
      keyboardStoppedAfterDestroy,
      touchpadTapFocusedKeyboard,
      multiTouchSkippedKeyboard,
      holdPressedRight: holdCalls.some(call => call.right),
      holdReleasedRight: holdCalls.some((call, index) => index > 0 && !call.right),
      dragMovedWhilePressed: dragCalls.some(call => call.left && call.x >= 120),
      dragReleasedLeft: dragCalls.some((call, index) => index > 0 && !call.left),
      stoppedAfterDestroy,
      touchpadMovedPointer: touchpadCalls.some(call => call.x > 0 && !call.left && !call.right),
      touchpadPressedRight: touchpadCalls.some(call => call.right),
      touchpadScrolled: touchpadCalls.some(call => call.up || call.down),
    };
  });

  expect(result).toEqual({
    directMode: 'direct',
    touchpadMode: 'touchpad',
    touchActionWhileAttached: 'none',
    touchActionAfterDestroy: '',
    cursorShowCount: expect.any(Number),
    allScaled: true,
    tapPressedLeft: true,
    tapReleasedLeft: true,
    directTapFocusedKeyboard: true,
    holdSkippedKeyboard: true,
    dragMoveDidNotAddExtraKeyboard: true,
    keyboardStoppedAfterDestroy: true,
    touchpadTapFocusedKeyboard: true,
    multiTouchSkippedKeyboard: true,
    holdPressedRight: true,
    holdReleasedRight: true,
    dragMovedWhilePressed: true,
    dragReleasedLeft: true,
    stoppedAfterDestroy: true,
    touchpadMovedPointer: true,
    touchpadPressedRight: true,
    touchpadScrolled: true,
  });
  expect(result.cursorShowCount).toBeGreaterThan(0);
});

test('mobile RDP touch mode toggle persists without reconnecting the session', async ({ page, context }) => {
  const connectionName = 'E2E Mobile RDP Touch Modes';
  const storageKey = 'nexus.rdp.touch-mode';

  await loginAsInitialAdmin(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();

  const existingResponse = await context.request.get('/api/v1/connections');
  expect(existingResponse.ok()).toBeTruthy();
  const existingConnections = await existingResponse.json() as Array<{ id: number; name?: string }>;
  for (const connection of existingConnections.filter(item => item.name === connectionName)) {
    expect((await context.request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
  }

  const createResponse = await context.request.post('/api/v1/connections', {
    data: {
      type: 'RDP',
      name: connectionName,
      host: '192.0.2.93',
      port: 3389,
      username: 'mobile-touch-e2e-user',
      password: 'mobile-touch-e2e-password',
    },
  });
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const connectionId = (await createResponse.json() as { connection: { id: number } }).connection.id;

  const openConnection = async () => {
    await page.goto('/workspace');
    await page.getByTestId('terminal-tab-bar').getByTitle('New Connection Tab').click();
    const connectionList = page.getByTestId('workspace-connection-list');
    await expect(connectionList).toBeVisible();
    await connectionList.getByText(connectionName, { exact: true }).first().click();
    await expect(page.getByTestId('remote-desktop-modal')).toBeVisible();
  };

  try {
    await page.goto('/login');
    await page.evaluate(key => window.localStorage.removeItem(key), storageKey);
    await openConnection();

    const directMode = page.getByTestId('rdp-touch-mode-direct');
    const touchpadMode = page.getByTestId('rdp-touch-mode-touchpad');
    const hint = page.getByTestId('rdp-touch-hint');

    await expect(directMode).toBeVisible();
    await expect(directMode).toHaveAttribute('aria-pressed', 'true');
    await expect(touchpadMode).toHaveAttribute('aria-pressed', 'false');
    await expect(hint).toContainText('Tap: click + keyboard');

    await touchpadMode.click();
    await expect(touchpadMode).toHaveAttribute('aria-pressed', 'true');
    await expect(directMode).toHaveAttribute('aria-pressed', 'false');
    await expect(hint).toContainText('One finger: move');
    await expect.poll(() => page.evaluate(key => window.localStorage.getItem(key), storageKey)).toBe('touchpad');

    await page.getByTestId('rdp-window-close').click();
    await expect(page.getByTestId('remote-desktop-modal')).toHaveCount(0);
    await openConnection();

    await expect(page.getByTestId('rdp-touch-mode-touchpad')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('rdp-touch-mode-direct').click();
    await expect.poll(() => page.evaluate(key => window.localStorage.getItem(key), storageKey)).toBe('direct');
  } finally {
    await context.request.delete(`/api/v1/connections/${connectionId}`);
  }
});

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
