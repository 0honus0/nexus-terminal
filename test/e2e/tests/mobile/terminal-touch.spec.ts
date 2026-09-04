import { expect, test, type BrowserContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

async function enableClipboard(context: BrowserContext): Promise<void> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
}

async function connectMobileTerminal(page: Page, request: Parameters<typeof loginAsInitialAdmin>[0]): Promise<void> {
  await loginAsInitialAdmin(request);
  await configureSshE2eSettings(request);
  const appearance = await request.put('/api/v1/appearance', { data: { terminalFontSizeMobile: 14 } });
  expect(appearance.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 20_000 });
}

async function dispatchPinch(page: Page, startSpan: number, endSpan: number): Promise<void> {
  const terminal = page.getByTestId('terminal').getByTestId('terminal-inner');
  const box = await terminal.boundingBox();
  expect(box).toBeTruthy();
  const centerX = box!.x + box!.width / 2;
  const centerY = box!.y + Math.min(box!.height / 2, 160);

  await terminal.evaluate(
    (element, gesture) => {
      const target = element as HTMLElement;
      const touch = (identifier: number, x: number, y: number) =>
        new Touch({
          identifier,
          target,
          clientX: x,
          clientY: y,
          pageX: x,
          pageY: y,
          screenX: x,
          screenY: y,
          radiusX: 8,
          radiusY: 8,
          rotationAngle: 0,
          force: 0.5,
        });
      const pair = (span: number) => [
        touch(1, gesture.centerX - span / 2, gesture.centerY),
        touch(2, gesture.centerX + span / 2, gesture.centerY),
      ];
      const start = pair(gesture.startSpan);
      target.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: start,
          targetTouches: start,
          changedTouches: start,
        }),
      );
      const moved = pair(gesture.endSpan);
      target.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: moved,
          targetTouches: moved,
          changedTouches: moved,
        }),
      );
      target.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
          touches: [],
          targetTouches: [],
          changedTouches: moved,
        }),
      );
    },
    { centerX, centerY, startSpan, endSpan },
  );
}

async function terminalTextPoint(page: Page, text: string): Promise<{ x: number; y: number }> {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        point = await page.getByTestId('terminal').evaluate((terminal, expected) => {
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

async function longPressTerminal(page: Page, point: { x: number; y: number }): Promise<void> {
  const terminal = page.getByTestId('terminal').getByTestId('terminal-inner');
  await terminal.evaluate((element, position) => {
    const target = element as HTMLElement;
    const touch = new Touch({
      identifier: 7,
      target,
      clientX: position.x,
      clientY: position.y,
      pageX: position.x,
      pageY: position.y,
      screenX: position.x,
      screenY: position.y,
      radiusX: 7,
      radiusY: 7,
      rotationAngle: 0,
      force: 0.5,
    });
    target.dispatchEvent(
      new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true,
        touches: [touch],
        targetTouches: [touch],
        changedTouches: [touch],
      }),
    );
  }, point);
  await page.waitForTimeout(620);
  await terminal.evaluate((element, position) => {
    const target = element as HTMLElement;
    const touch = new Touch({
      identifier: 7,
      target,
      clientX: position.x,
      clientY: position.y,
      pageX: position.x,
      pageY: position.y,
      screenX: position.x,
      screenY: position.y,
      radiusX: 7,
      radiusY: 7,
      rotationAngle: 0,
      force: 0,
    });
    target.dispatchEvent(
      new TouchEvent('touchend', {
        bubbles: true,
        cancelable: true,
        touches: [],
        targetTouches: [],
        changedTouches: [touch],
      }),
    );
  }, point);
}

test('mobile pinch zoom persists the mobile terminal font size even when the tab closes immediately', async ({
  page,
  context,
}) => {
  await connectMobileTerminal(page, context.request);
  const terminal = page.getByTestId('terminal');
  await expect(terminal).toHaveAttribute('data-font-size', '14');

  await step('two-finger pinch updates the rendered xterm font size', async () => {
    await dispatchPinch(page, 80, 120);
    await expect(terminal).toHaveAttribute('data-font-size', '21');
  });

  await slowStep('closing the tab flushes the pending mobile-only appearance save', async () => {
    await page.getByRole('button', { name: 'Close Tab' }).click();
    await expect(terminal).toBeHidden();
    await expect
      .poll(
        async () => {
          const appearance = await context.request.get('/api/v1/appearance');
          expect(appearance.ok()).toBeTruthy();
          return Number(((await appearance.json()) as { terminalFontSizeMobile?: number }).terminalFontSizeMobile);
        },
        { timeout: 5_000 },
      )
      .toBe(21);
  });
});

test('mobile terminal long press selects a word, exposes selection handles, and copies exact xterm text', async ({
  page,
  context,
}) => {
  await enableClipboard(context);
  await connectMobileTerminal(page, context.request);
  const marker = 'MOBILE_TOUCH_COPY_MARKER';
  const commandInput = page.getByTestId('command-input');
  const rows = page.getByTestId('terminal').locator('.xterm-rows');

  await step('render a deterministic word and long-press directly on its xterm cells', async () => {
    await commandInput.fill(`printf '\\033[2J\\033[H\\n\\n\\n${marker}\\n'`);
    await commandInput.press('Enter');
    await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain(marker);
    const point = await terminalTextPoint(page, marker);
    await longPressTerminal(page, point);
  });

  await step('touch selection shows the mobile clipboard menu and both draggable handles', async () => {
    const menu = page.locator('.mobile-terminal-clipboard-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
    await expect(menu.getByRole('button', { name: 'Paste', exact: true })).toBeEnabled();
    await expect(menu.getByRole('button', { name: 'Select All', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Adjust selection start', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adjust selection end', exact: true })).toBeVisible();
    await captureFunctionalScreenshot(page, 'mobile-terminal-selection.png');
  });

  await step('Copy writes the exact selected terminal word and clears the touch-selection chrome', async () => {
    const menu = page.locator('.mobile-terminal-clipboard-menu');
    await menu.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator('.mobile-terminal-selection-handle')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(marker);
  });
});

test('mobile clipboard Paste normalizes CR line endings and executes through the live SSH terminal', async ({
  page,
  context,
}) => {
  await enableClipboard(context);
  await connectMobileTerminal(page, context.request);
  const terminal = page.getByTestId('terminal');
  const rows = terminal.locator('.xterm-rows');

  await page.evaluate((text) => navigator.clipboard.writeText(text), "printf 'MOBILE_TOUCH_PASTE_OK\\n'\r");

  await step('mobile context menu fallback exposes Paste even without a native browser menu', async () => {
    const inner = terminal.getByTestId('terminal-inner');
    const box = await inner.boundingBox();
    expect(box).toBeTruthy();
    await inner.dispatchEvent('contextmenu', {
      clientX: box!.x + Math.min(40, box!.width / 4),
      clientY: box!.y + Math.min(120, box!.height / 3),
      button: 2,
    });
    const menu = page.locator('.mobile-terminal-clipboard-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Paste', exact: true })).toBeEnabled();
  });

  await slowStep('Paste converts the clipboard CR terminator to a newline and runs the command over SSH', async () => {
    await page.locator('.mobile-terminal-clipboard-menu').getByRole('button', { name: 'Paste', exact: true }).click();
    await expect(page.locator('.mobile-terminal-clipboard-menu')).toBeHidden();
    await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain('MOBILE_TOUCH_PASTE_OK');
  });
});
