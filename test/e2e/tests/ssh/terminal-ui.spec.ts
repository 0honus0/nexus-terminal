import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step } from '../../support/steps';

async function captureTerminalEvidence(page: Page, testInfo: TestInfo, name: 'before' | 'after'): Promise<void> {
  const metrics = await page.evaluate(() => {
    const terminal = document.querySelector<HTMLElement>('[data-testid="terminal"]');
    const inner = terminal?.querySelector<HTMLElement>('[data-testid="terminal-inner"]');
    const commandBar = document.querySelector<HTMLElement>('[data-testid="command-input-bar"]');
    const commandInput = commandBar?.querySelector<HTMLElement>('[data-testid="command-input"]');
    const rect = (element: Element | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    };
    const innerStyle = inner ? getComputedStyle(inner) : null;
    const terminalStyle = terminal ? getComputedStyle(terminal) : null;
    return {
      language: document.documentElement.lang,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      terminal: rect(terminal),
      terminalFontSize: terminal?.getAttribute('data-font-size') ?? '',
      terminalBackground: terminalStyle?.backgroundColor ?? '',
      inner: rect(inner),
      innerPadding: {
        top: innerStyle?.paddingTop ?? '',
        right: innerStyle?.paddingRight ?? '',
        bottom: innerStyle?.paddingBottom ?? '',
        left: innerStyle?.paddingLeft ?? '',
      },
      commandBar: rect(commandBar),
      commandInput: rect(commandInput),
      commandInputHeight: commandInput?.getBoundingClientRect().height ?? 0,
    };
  });
  const screenshotPath = testInfo.outputPath(`terminal-input-resize-${name}.png`);
  const metricsPath = testInfo.outputPath(`terminal-input-resize-${name}.metrics.json`);
  await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled', caret: 'hide' });
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  await testInfo.attach(`M10.03-a terminal ${name} screenshot`, {
    path: screenshotPath,
    contentType: 'image/png',
  });
  await testInfo.attach(`M10.03-a terminal ${name} metrics`, {
    path: metricsPath,
    contentType: 'application/json',
  });
  console.log(
    `[M10.03-a terminal ${name} metrics] language=${metrics.language} viewport=${metrics.viewport.width}x${metrics.viewport.height} pageScrollWidth=${metrics.pageScrollWidth} bodyScrollWidth=${metrics.bodyScrollWidth} terminalFontSize=${metrics.terminalFontSize} innerPadding=${metrics.innerPadding.top}/${metrics.innerPadding.right}/${metrics.innerPadding.bottom}/${metrics.innerPadding.left} commandInputHeight=${metrics.commandInputHeight}`,
  );
  expect(metrics.language).toMatch(/^en(?:-US)?$/);
  expect(metrics.viewport).toEqual({ width: 1280, height: 800 });
  expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.terminal?.x).toBeGreaterThanOrEqual(0);
  expect(metrics.terminal?.right).toBeLessThanOrEqual(metrics.viewport.width + 1);
  expect(metrics.terminal?.width).toBeGreaterThan(0);
  expect(metrics.terminal?.height).toBeGreaterThan(100);
  expect(metrics.inner?.width).toBeGreaterThan(0);
  expect(metrics.inner?.height).toBeGreaterThan(0);
  expect(metrics.innerPadding).toEqual({ top: '4px', right: '5px', bottom: '3px', left: '5px' });
  expect(Number(metrics.terminalFontSize)).toBeGreaterThan(0);
  expect(metrics.commandBar?.x).toBeGreaterThanOrEqual(0);
  expect(metrics.commandBar?.right).toBeLessThanOrEqual(metrics.viewport.width + 1);
  expect(metrics.commandInputHeight).toBeGreaterThan(0);
}

test('connected SSH terminal accepts commands and keeps the rendered terminal alive', async ({
  page,
  context,
}, testInfo) => {
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

  await step('terminal remains mounted after workspace connection', async () => {
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect(terminal.locator('.xterm-screen')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await captureTerminalEvidence(page, testInfo, 'before');
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

  await step('shared Progress Display stays dormant until there is hidden transfer work', async () => {
    await expect(page.getByTestId('transfer-progress-toggle')).toHaveCount(0);
  });

  await step('interactive keystrokes use the low-latency terminal input path', async () => {
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
            if (frame.type === 'terminal.input' && frame.payload?.data === 'x') return frame;
          } catch {
            /* ignore non-JSON text frames */
          }
        }
        return null;
      })
      .toMatchObject({ type: 'terminal.input', payload: { data: 'x' } });

    let interactiveFrame: any = null;
    for (let index = sentTextFrames.length - 1; index >= 0; index -= 1) {
      try {
        const frame = JSON.parse(sentTextFrames[index]);
        if (frame?.type === 'terminal.input' && frame?.payload?.data === 'x') {
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
    const inner = terminal.getByTestId('terminal-inner');
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
    await captureTerminalEvidence(page, testInfo, 'after');
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
  const inner = terminal.getByTestId('terminal-inner');
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
