import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step } from '../../support/steps';

test('connected SSH terminal accepts commands and keeps the rendered terminal alive', async ({ page, context }) => {
  const sentTextFrames: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => {
      if (typeof event.payload === 'string') sentTextFrames.push(event.payload);
    });
  });

  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const terminal = page.getByTestId('terminal');
  const commandInput = page.getByTestId('command-input');

  await step('terminal remains mounted after ssh:connected', async () => {
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect(terminal.locator('.xterm-screen')).toBeVisible();
    const box = await terminal.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThan(100);
  });

  await step('terminal cursor is a fixed white block without blink animation', async () => {
    await terminal.click();
    const cursor = terminal.locator('.xterm-cursor.xterm-cursor-block').first();
    await expect(cursor).toBeVisible();
    await expect(cursor).not.toHaveClass(/xterm-cursor-blink/);
    await expect
      .poll(() =>
        cursor.evaluate((element) => {
          const style = window.getComputedStyle(element);
          return {
            backgroundColor: style.backgroundColor,
            color: style.color,
            animationName: style.animationName,
          };
        }),
      )
      .toEqual({
        backgroundColor: 'rgb(255, 255, 255)',
        color: 'rgb(0, 0, 0)',
        animationName: 'none',
      });
  });

  await step('global transfer progress can minimize and restore from the toolbar', async () => {
    const transferToggle = page.getByTestId('transfer-progress-toggle');
    await transferToggle.click();
    const progressPanel = page.locator('.transfer-progress-panel');
    await expect(progressPanel).toBeVisible();
    await progressPanel.getByTestId('transfer-progress-minimize').click();
    await expect(progressPanel).toBeHidden();
    await transferToggle.click();
    await expect(progressPanel).toBeVisible();
    await progressPanel.getByRole('button', { name: 'Close' }).click();
    await expect(progressPanel).toBeHidden();
  });

  await step('interactive keystrokes use the low-latency SSH input path', async () => {
    await terminal.click();
    await page.keyboard.type('x');
    await expect
      .poll(() => {
        for (let index = sentTextFrames.length - 1; index >= 0; index -= 1) {
          try {
            const frame = JSON.parse(sentTextFrames[index]) as {
              type?: string;
              payload?: { data?: string; sequence?: number };
            };
            if (frame.type === 'ssh:input' && frame.payload?.data === 'x') return frame;
          } catch {
            /* ignore non-JSON text frames */
          }
        }
        return null;
      })
      .toMatchObject({ type: 'ssh:input', payload: { data: 'x' } });

    let interactiveFrame: any = null;
    for (let index = sentTextFrames.length - 1; index >= 0; index -= 1) {
      try {
        const frame = JSON.parse(sentTextFrames[index]);
        if (frame?.type === 'ssh:input' && frame?.payload?.data === 'x') {
          interactiveFrame = frame;
          break;
        }
      } catch {
        /* ignore non-JSON text frames */
      }
    }
    expect(interactiveFrame?.payload?.sequence).toBeUndefined();
    await page.keyboard.press('Control+C');
  });

  await step('terminal Ctrl+wheel ignores tiny direction reversals and changes only on a full step', async () => {
    const inner = terminal.locator('.terminal-inner-container');
    const initial = Number(await terminal.getAttribute('data-font-size'));
    expect(initial).toBeGreaterThan(0);

    await inner.dispatchEvent('wheel', { ctrlKey: true, deltaY: -20, deltaMode: 0 });
    await inner.dispatchEvent('wheel', { ctrlKey: true, deltaY: 20, deltaMode: 0 });
    expect(Number(await terminal.getAttribute('data-font-size'))).toBe(initial);

    await inner.dispatchEvent('wheel', { ctrlKey: true, deltaY: -80, deltaMode: 0 });
    await expect.poll(async () => Number(await terminal.getAttribute('data-font-size'))).toBe(initial + 1);
    await inner.dispatchEvent('wheel', { ctrlKey: true, deltaY: 20, deltaMode: 0 });
    await page.waitForTimeout(80);
    expect(Number(await terminal.getAttribute('data-font-size'))).toBe(initial + 1);
  });

  await step('command input executes a real command in the persistent SSH shell', async () => {
    await expect(commandInput).toBeVisible();
    await commandInput.fill("printf 'NEXUS_TERMINAL_E2E\\n'");
    await commandInput.press('Enter');
    await expect
      .poll(async () => terminal.locator('.xterm-rows').innerText(), { timeout: 15_000 })
      .toContain('NEXUS_TERMINAL_E2E');
  });

  await step('shell cwd persists between commands', async () => {
    await commandInput.fill('cd folder-seed');
    await commandInput.press('Enter');
    await commandInput.fill('printf \'CWD=%s\\n\' "$PWD"');
    await commandInput.press('Enter');
    await expect.poll(async () => terminal.locator('.xterm-rows').innerText(), { timeout: 15_000 }).toContain('CWD=');
    await expect
      .poll(async () => terminal.locator('.xterm-rows').innerText(), { timeout: 15_000 })
      .toContain('folder-seed');
  });
});

test('terminal font-size wheel change persists when the session is closed before debounce fires', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const resetAppearance = await context.request.put('/api/v1/appearance', { data: { terminalFontSize: 14 } });
  expect(resetAppearance.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const terminal = page.getByTestId('terminal');
  await expect(terminal).toBeVisible({ timeout: 20_000 });
  await expect(terminal).toHaveAttribute('data-font-size', '14');
  const inner = terminal.locator('.terminal-inner-container');
  await inner.dispatchEvent('wheel', { ctrlKey: true, deltaY: -80, deltaMode: 0 });
  await expect(terminal).toHaveAttribute('data-font-size', '15');

  const closeTabButton = page.getByRole('button', { name: 'Close Tab' });
  await closeTabButton.click();
  await expect(terminal).toBeHidden();

  await expect
    .poll(
      async () => {
        const appearance = await context.request.get('/api/v1/appearance');
        expect(appearance.ok()).toBeTruthy();
        return Number((await appearance.json()).terminalFontSize);
      },
      { timeout: 3_000 },
    )
    .toBe(15);
});
