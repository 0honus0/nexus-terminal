import { writeFile } from 'node:fs/promises';
import type { Page, Route, TestInfo } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step } from '../../support/steps';
import { E2E_URLS } from '../../support/test-env';

async function holdFirstTwoTerminalFontWrites(page: Page): Promise<{
  firstStarted: Promise<void>;
  secondStarted: Promise<void>;
  releaseFirst: () => void;
  releaseSecond: () => void;
  dispose: () => Promise<void>;
}> {
  let firstStartedResolve!: () => void;
  let secondStartedResolve!: () => void;
  let releaseFirstResolve!: () => void;
  let releaseSecondResolve!: () => void;
  const firstStarted = new Promise<void>((resolve) => (firstStartedResolve = resolve));
  const secondStarted = new Promise<void>((resolve) => (secondStartedResolve = resolve));
  const firstReleased = new Promise<void>((resolve) => (releaseFirstResolve = resolve));
  const secondReleased = new Promise<void>((resolve) => (releaseSecondResolve = resolve));
  let matchingRequestCount = 0;

  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'PUT') {
      await route.continue();
      return;
    }
    let body: Record<string, unknown> = {};
    try {
      body = request.postDataJSON() as Record<string, unknown>;
    } catch {
      await route.continue();
      return;
    }
    if (!('terminalFontSize' in body)) {
      await route.continue();
      return;
    }

    matchingRequestCount += 1;
    const backendResponse = await route.fetch();
    if (matchingRequestCount === 1) {
      firstStartedResolve();
      await firstReleased;
    } else if (matchingRequestCount === 2) {
      secondStartedResolve();
      await secondReleased;
    }
    await route.fulfill({ response: backendResponse });
  };

  await page.route('**/api/v1/appearance', handler);
  return {
    firstStarted,
    secondStarted,
    releaseFirst: () => releaseFirstResolve(),
    releaseSecond: () => releaseSecondResolve(),
    dispose: async () => {
      releaseFirstResolve();
      releaseSecondResolve();
      await page.unroute('**/api/v1/appearance', handler);
    },
  };
}

async function terminalTextPoint(page: Page, text: string): Promise<{ x: number; y: number }> {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        point = await page.locator('[data-font-size]').evaluate((terminal, expected) => {
          const rows = [...terminal.querySelectorAll<HTMLElement>('.xterm-rows > div')];
          const row = rows.find((candidate) => candidate.textContent?.trim() === expected);
          if (!row) return null;
          const textNode = row.querySelector<HTMLElement>('span') ?? row;
          const rect = textNode.getBoundingClientRect();
          return {
            x: rect.left + Math.max(2, Math.min(rect.width - 2, rect.width / 2)),
            y: rect.top + rect.height / 2,
          };
        }, text);
        return point !== null;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return point!;
}

async function captureTerminalEvidence(page: Page, testInfo: TestInfo, name: 'before' | 'after'): Promise<void> {
  const metrics = await page.evaluate(() => {
    const terminal = document.querySelector<HTMLElement>('[data-font-size]');
    const inner = terminal?.querySelector<HTMLElement>('.terminal-inner-container');
    const commandBar = document.querySelector<HTMLElement>('.command-bar-root');
    const commandInput = commandBar?.querySelector<HTMLElement>('.command-bar-command-input');
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

  const terminal = page.locator('[data-font-size]');
  const commandInput = page.locator('.command-bar-command-input');

  await step('terminal remains mounted after workspace connection', async () => {
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect(terminal.locator('.xterm-screen')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await captureTerminalEvidence(page, testInfo, 'before');
    const box = await terminal.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThan(100);
    await expect
      .poll(() => terminal.locator('.xterm-viewport').evaluate((element) => getComputedStyle(element).overflowY))
      .toBe('auto');
  });

  await step('desktop tab bar aligns with the active Workspace content region', async () => {
    const workspaceBox = await page.locator('main').boundingBox();
    const tabBarBox = await page.locator('.terminal-tab-shell').getByRole('tablist').boundingBox();
    const sessionRegionBox = await page.locator('main > div.relative.min-h-0.flex-1').boundingBox();
    expect(workspaceBox).toBeTruthy();
    expect(tabBarBox).toBeTruthy();
    expect(sessionRegionBox).toBeTruthy();
    expect(Math.abs(tabBarBox!.x - workspaceBox!.x - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(workspaceBox!.x + workspaceBox!.width - tabBarBox!.x - tabBarBox!.width - 8)).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(tabBarBox!.y - workspaceBox!.y - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(tabBarBox!.x - sessionRegionBox!.x)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(tabBarBox!.x + tabBarBox!.width - (sessionRegionBox!.x + sessionRegionBox!.width)),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(sessionRegionBox!.y - (tabBarBox!.y + tabBarBox!.height))).toBeLessThanOrEqual(1);
    expect(
      Math.abs(workspaceBox!.y + workspaceBox!.height - sessionRegionBox!.y - sessionRegionBox!.height - 8),
    ).toBeLessThanOrEqual(1);
    await expect
      .poll(() =>
        page
          .locator('.terminal-tab-shell')
          .getByRole('tablist')
          .evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              left: style.borderLeftWidth,
              right: style.borderRightWidth,
              bottom: style.borderBottomWidth,
              top: style.borderTopWidth,
              topLeftRadius: style.borderTopLeftRadius,
              topRightRadius: style.borderTopRightRadius,
            };
          }),
      )
      .toEqual({
        left: '1px',
        right: '1px',
        bottom: '1px',
        top: '1px',
        topLeftRadius: '6px',
        topRightRadius: '6px',
      });
    await expect
      .poll(() =>
        page.locator('main > div.relative.min-h-0.flex-1').evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            left: style.borderLeftWidth,
            right: style.borderRightWidth,
            bottom: style.borderBottomWidth,
            top: style.borderTopWidth,
            bottomLeftRadius: style.borderBottomLeftRadius,
            bottomRightRadius: style.borderBottomRightRadius,
          };
        }),
      )
      .toEqual({
        left: '1px',
        right: '1px',
        bottom: '1px',
        top: '0px',
        bottomLeftRadius: '6px',
        bottomRightRadius: '6px',
      });
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
    await expect(page.getByRole('button', { name: 'Progress Display', exact: true })).toHaveCount(0);
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

  await step(
    'long terminal input and IME composition cannot horizontally shift the terminal window boundary',
    async () => {
      const viewport = terminal.locator('.xterm-viewport');
      const input = terminal.locator('.xterm-helper-textarea');
      const before = await terminal.boundingBox();
      expect(before).toBeTruthy();
      await input.focus();
      const firstTypedFrame = sentTextFrames.length;
      await page.keyboard.type('x'.repeat(600));
      // Ctrl+C is sent directly, so wait until every typed byte left the browser before interrupting the line.
      await expect
        .poll(
          () =>
            sentTextFrames.slice(firstTypedFrame).reduce((count, rawFrame) => {
              try {
                const frame = JSON.parse(rawFrame) as { type?: string; payload?: { data?: string } };
                return frame.type === 'terminal.input' ? count + (frame.payload?.data?.length ?? 0) : count;
              } catch {
                return count;
              }
            }, 0),
          { timeout: 15_000 },
        )
        .toBeGreaterThanOrEqual(600);
      await expect
        .poll(() =>
          viewport.evaluate((element) => ({
            overflowX: getComputedStyle(element).overflowX,
            scrollLeft: element.scrollLeft,
          })),
        )
        .toEqual({ overflowX: 'hidden', scrollLeft: 0 });
      const after = await terminal.boundingBox();
      expect(after).toEqual(before);
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
      await page.keyboard.press('Control+C');

      // Simulate IME composition near end of line
      await input.evaluate((element) => {
        element.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
        element.dispatchEvent(new CompositionEvent('compositionupdate', { data: "f's'd'fa'a'fa's'f" }));
      });
      const compositionAfter = await terminal.boundingBox();
      expect(compositionAfter).toEqual(before);
      expect(await terminal.evaluate((element) => element.scrollLeft)).toBe(0);
      expect(await terminal.locator('.terminal-inner-container').evaluate((element) => element.scrollLeft)).toBe(0);
      await input.evaluate((element) => {
        element.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
      });
      await page.keyboard.press('Control+C');

      // The E2E SSH shell is interactive over pipes rather than a controlling TTY, so Ctrl+C is
      // an input byte instead of a terminal-driver signal. Submit the pending line before later
      // command-bar checks so this layout scenario cannot leak its 600-byte fixture into them.
      const resetMarker = `TERMINAL_INPUT_RESET_${crypto.randomUUID()}`;
      await commandInput.fill('');
      await commandInput.press('Enter');
      await commandInput.fill(`printf '${resetMarker}\\n'`);
      await commandInput.press('Enter');
      await expect
        .poll(async () => terminal.locator('.xterm-rows').innerText(), { timeout: 15_000 })
        .toContain(resetMarker);
    },
  );

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

  await step('command bar omits the send-to-all shortcut', async () => {
    const commandBar = page.locator('.command-bar-root');
    await expect(commandBar.locator('.fa-share-alt')).toHaveCount(0);
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

test('Ctrl+C interrupts a long-running terminal output stream', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  let streamedBytes = 0;
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/ws/workspace') return;
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') streamedBytes += payload.byteLength;
    });
  });
  await connectTestSshFromConnectionsPage(page, connectionId);

  const terminal = page.locator('[data-font-size]');
  const rows = terminal.locator('.xterm-rows');
  const commandInput = page.locator('.command-bar-command-input');
  await commandInput.fill(
    'saved_stty=$(stty -g); stty -isig; INTERRUPT_FINISHED=yes; (i=0; while :; do batch=0; while [ $batch -lt 20 ]; do printf \'INTERRUPT_STREAM_%06d\\n\' "$i"; i=$((i+1)); batch=$((batch+1)); done; sleep 0.01; done) & producer=$!; while IFS= read -r -n 1 key; do if [ "$key" = $\'\\003\' ]; then INTERRUPT_FINISHED=no; break; fi; done; kill "$producer"; wait "$producer" 2>/dev/null; stty "$saved_stty"; printf \'INTERRUPT_ACK\\n\'',
  );
  await commandInput.press('Enter');
  await expect.poll(() => streamedBytes, { timeout: 15_000 }).toBeGreaterThan(32 * 1024);

  await terminal.locator('textarea').focus();
  await page.keyboard.press('Control+c');
  await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain('INTERRUPT_ACK');
  await commandInput.fill('printf \'INTERRUPT_RESULT=%s\\n\' "$INTERRUPT_FINISHED"');
  await commandInput.press('Enter');
  await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain('INTERRUPT_RESULT=no');
});

test('large terminal scrollback follows rapid scrollbar drags back to the newest output', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings', {
    data: { terminalScrollbackLimit: 100000 },
  });
  expect(settings.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const terminal = page.locator('[data-font-size]');
  const rows = terminal.locator('.xterm-rows');
  const commandInput = page.locator('.command-bar-command-input');
  const bottomMarker = 'RAPID_SCROLL_BOTTOM';
  await commandInput.fill(
    `i=1; while [ $i -le 12000 ]; do printf 'RAPID_SCROLL_%05d\\n' "$i"; i=$((i+1)); done; printf '${bottomMarker}\\n'`,
  );
  await commandInput.press('Enter');
  await expect.poll(async () => rows.innerText(), { timeout: 30_000 }).toContain(bottomMarker);

  const scrollable = terminal.locator('.xterm-scrollable-element').first();
  const scrollableBox = await scrollable.boundingBox();
  expect(scrollableBox).toBeTruthy();
  await page.mouse.move(scrollableBox!.x + scrollableBox!.width - 2, scrollableBox!.y + scrollableBox!.height / 2);
  const scrollbar = scrollable.locator(':scope > .scrollbar.vertical').first();
  await expect(scrollbar).toHaveClass(/visible/);
  const slider = scrollbar.locator(':scope > .slider');
  await expect(slider).toBeVisible();

  const scrollbarBox = await scrollbar.boundingBox();
  const sliderBox = await slider.boundingBox();
  expect(scrollbarBox).toBeTruthy();
  expect(sliderBox).toBeTruthy();
  expect(sliderBox!.height).toBeLessThan(scrollbarBox!.height / 2);
  const x = sliderBox!.x + sliderBox!.width / 2;
  const top = scrollbarBox!.y + 2;
  const bottom = scrollbarBox!.y + scrollbarBox!.height - 2;

  await page.mouse.move(x, sliderBox!.y + sliderBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, top, { steps: 2 });
  await page.mouse.move(x, bottom, { steps: 2 });
  await page.mouse.move(x, top, { steps: 2 });
  await page.mouse.move(x, bottom, { steps: 2 });
  await page.mouse.up();

  await expect.poll(async () => rows.innerText(), { timeout: 5_000 }).toContain(bottomMarker);
  const finalScrollbarBox = await scrollbar.boundingBox();
  const finalSliderBox = await slider.boundingBox();
  expect(finalScrollbarBox).toBeTruthy();
  expect(finalSliderBox).toBeTruthy();
  expect(
    Math.abs(finalScrollbarBox!.y + finalScrollbarBox!.height - (finalSliderBox!.y + finalSliderBox!.height)),
  ).toBeLessThanOrEqual(3);
});

test('terminal rejects oversized pasted input and remains usable', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: E2E_URLS.frontendLoopbackOrigin });
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  const terminal = page.locator('[data-font-size]');
  const sentInput: string[] = [];
  // Observe the already-open transport through the browser's network domain.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    if (response.opcode === 1 && response.payloadData.includes('terminal.input')) sentInput.push(response.payloadData);
  });
  await page.evaluate(() => navigator.clipboard.writeText('界'.repeat(90_000)));
  await terminal.locator('textarea').focus();
  await page.keyboard.press('Control+Shift+V');
  await expect(page.getByText(/终端输入未发送|Terminal input was not sent/).first()).toBeVisible();
  expect(sentInput).toHaveLength(0);
  await page.evaluate(() => navigator.clipboard.writeText("printf 'INPUT_AFTER_REJECTION_OK\\n'\r"));
  await page.keyboard.press('Control+Shift+V');
  await expect.poll(() => terminal.locator('.xterm-rows').innerText()).toContain('INPUT_AFTER_REJECTION_OK');
  await cdp.detach();
});

test('desktop terminal right-click copies a selection then pastes when no selection remains', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: E2E_URLS.frontendLoopbackOrigin });
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const preferences = await context.request.put('/api/v1/settings', {
    data: { terminalRightClickCopyPaste: true },
  });
  expect(preferences.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const terminal = page.locator('[data-font-size]');
  const commandInput = page.locator('.command-bar-command-input');
  const rows = terminal.locator('.xterm-rows');
  const copyMarker = 'DESKTOP_RIGHT_CLICK_COPY_MARKER';

  await step('right-click on an xterm selection copies the selected word', async () => {
    await commandInput.fill(`printf '\\033[2J\\033[H\\n\\n\\n${copyMarker}\\n'`);
    await commandInput.press('Enter');
    await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain(copyMarker);
    const point = await terminalTextPoint(page, copyMarker);
    await page.mouse.dblclick(point.x, point.y);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(copyMarker);
    await expect(terminal.locator('.xterm-selection > div')).toHaveCount(0);
    const splitter = page.locator('[role="separator"][aria-orientation="vertical"]:visible').last();
    const bounds = await splitter.boundingBox();
    expect(bounds).toBeTruthy();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds!.x - 30, bounds!.y + bounds!.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(terminal.locator('.xterm-selection > div')).toHaveCount(0);
  });

  await step('the same right-click path pastes after the copied selection was cleared', async () => {
    const pasteCommand = "printf 'DESKTOP_RIGHT_CLICK_PASTE_OK\\n'\r";
    await page.evaluate((text) => navigator.clipboard.writeText(text), pasteCommand);
    const inner = terminal.locator('.terminal-inner-container');
    const box = await inner.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.click(box!.x + Math.min(40, box!.width / 4), box!.y + Math.min(100, box!.height / 3), {
      button: 'right',
    });
    await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain('DESKTOP_RIGHT_CLICK_PASTE_OK');
  });

  await step('mouse-aware apps keep right-click and use keyboard clipboard shortcuts', async () => {
    const mouseMarker = 'DESKTOP_MOUSE_REPORTING_COPY_MARKER';
    await commandInput.fill(`printf '\\n${mouseMarker}\\n\\033[?1000h\\033[?1006h'; cat -v`);
    await commandInput.press('Enter');
    await expect.poll(async () => rows.innerText()).toContain(mouseMarker);
    const point = await terminalTextPoint(page, mouseMarker);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect.poll(async () => rows.innerText()).toMatch(/\^\[\[<2;/);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe(mouseMarker);

    await page.keyboard.down('Shift');
    await page.mouse.dblclick(point.x, point.y);
    await page.keyboard.up('Shift');
    await page.keyboard.press('Control+Shift+C');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(mouseMarker);

    await page.evaluate(() => navigator.clipboard.writeText('DESKTOP_MOUSE_REPORTING_PASTE_OK'));
    await page.keyboard.press('Control+Shift+V');
    await expect.poll(async () => rows.innerText()).toContain('DESKTOP_MOUSE_REPORTING_PASTE_OK');
  });

  await step('application clipboard writes use OSC 52 without interpreting application shortcuts', async () => {
    await page.keyboard.press('Control+C');
    const text = `通用终端复制\n${Array.from({ length: 2000 }, (_, index) => index + 1).join('\n')}`;
    const input = terminal.locator('.xterm-helper-textarea');
    await input.pressSequentially(
      "printf '\\033]52;c;'; { printf '通用终端复制\\n'; seq 1 2000; } | base64 -w0; printf '\\007'",
      { delay: 0 },
    );
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${text}\n`);
    await input.pressSequentially("printf '\\033]52;c;?\\007\\033]52;c;invalid!\\007'", { delay: 0 });
    await input.press('Enter');
    await expect.poll(async () => rows.innerText()).toContain('invalid!');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${text}\n`);
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

  const terminal = page.locator('[data-font-size]');
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

test('rapid terminal Ctrl+wheel keeps the newest rendered size while older appearance responses settle', async ({
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

  const terminal = page.locator('[data-font-size]');
  const inner = terminal.locator('.terminal-inner-container');
  await expect(terminal).toHaveAttribute('data-font-size', '14');
  const held = await holdFirstTwoTerminalFontWrites(page);

  try {
    await inner.dispatchEvent('wheel', { ctrlKey: true, deltaY: -80, deltaMode: 0 });
    await expect(terminal).toHaveAttribute('data-font-size', '15');
    await held.firstStarted;

    await inner.dispatchEvent('wheel', { ctrlKey: true, deltaY: -80, deltaMode: 0 });
    await expect(terminal).toHaveAttribute('data-font-size', '16');

    held.releaseFirst();
    await held.secondStarted;
    await page.waitForTimeout(350);
    await expect(terminal).toHaveAttribute('data-font-size', '16');

    held.releaseSecond();
    await expect
      .poll(
        async () => {
          const appearance = await context.request.get('/api/v1/appearance');
          expect(appearance.ok()).toBeTruthy();
          return Number((await appearance.json()).terminalFontSize);
        },
        { timeout: 3_000 },
      )
      .toBe(16);
    await expect(terminal).toHaveAttribute('data-font-size', '16');
  } finally {
    await held.dispose();
  }
});

test('desktop touch hardware keeps the legacy desktop Workspace classification', async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = ((query: string): MediaQueryList => {
      if (query !== '(pointer: coarse)') return nativeMatchMedia(query);
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
      } as MediaQueryList;
    }) as typeof window.matchMedia;
  });

  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const capabilities = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
  }));
  expect(capabilities.userAgent).not.toMatch(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i);
  expect(capabilities.maxTouchPoints).toBe(5);
  expect(capabilities.coarsePointer).toBe(true);

  const tabBar = page.locator('.terminal-tab-shell');
  await expect(tabBar.getByRole('button', { name: 'Configure Layout', exact: true })).toBeVisible();
  await expect(page.locator('.command-bar-command-input')).toBeVisible();
});

test('a failed logout still releases live Workspace sessions before reporting the error', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { navBarVisible: true } })).ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const tabBar = page.locator('.terminal-tab-shell');
  await expect(tabBar.getByRole('tab')).toHaveCount(1);
  await page.route('**/api/v1/auth/logout', async (route) => route.abort('failed'));

  await page.getByRole('link', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('alert')).not.toHaveText('');
  await expect(page).toHaveURL(/\/workspace(?:\?|$)/);
  await expect(tabBar.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Connections & sessions', exact: true })).toBeVisible();

  const status = await context.request.get('/api/v1/auth/status');
  expect(status.ok()).toBeTruthy();
  await expect(status.json()).resolves.toMatchObject({ isAuthenticated: true });
  await page.unroute('**/api/v1/auth/logout');
});

test('a protected API 401 invalidates the local session and releases the live Workspace', async ({ page, context }) => {
  let workspaceSocketClosed = false;
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/ws/workspace')) return;
    socket.on('close', () => {
      workspaceSocketClosed = true;
    });
  });

  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { navBarVisible: true } })).ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const tabBar = page.locator('.terminal-tab-shell');
  await expect(tabBar.getByRole('tab')).toHaveCount(1);
  await expect(tabBar.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();

  const serverLogout = await context.request.post('/api/v1/auth/logout');
  expect(serverLogout.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/workspace(?:\?|$)/);

  const unauthorized = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/settings') &&
      response.request().method() === 'PUT' &&
      (response.request().postDataJSON() as { navBarVisible?: boolean } | null)?.navBarVisible === false &&
      response.status() === 401,
  );
  await tabBar.getByRole('button', { name: 'Hide', exact: true }).click();
  await unauthorized;

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'User Login', exact: true })).toBeVisible();
  await expect.poll(() => workspaceSocketClosed, { timeout: 15_000 }).toBe(true);
});
