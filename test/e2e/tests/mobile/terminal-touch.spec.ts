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

async function terminalTextareaState(page: Page): Promise<{
  active: boolean;
  inputMode: string | null;
  readOnly: boolean;
}> {
  return page
    .getByTestId('terminal')
    .locator('.xterm-helper-textarea')
    .evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      return {
        active: document.activeElement === textarea,
        inputMode: textarea.getAttribute('inputmode'),
        readOnly: textarea.readOnly,
      };
    });
}

async function longPressTerminal(
  page: Page,
  point: { x: number; y: number },
  duringHold?: () => Promise<void>,
): Promise<void> {
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
  await page.waitForTimeout(120);
  if (duringHold) await duringHold();
  await page.waitForTimeout(500);
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

async function swipeTerminal(page: Page, deltaY: number): Promise<void> {
  const terminal = page.getByTestId('terminal').getByTestId('terminal-inner');
  const box = await terminal.boundingBox();
  expect(box).toBeTruthy();
  const x = box!.x + box!.width / 2;
  const margin = Math.min(56, box!.height / 5);
  const startY = deltaY < 0 ? box!.y + box!.height - margin : box!.y + margin;
  const endY = Math.max(box!.y + 8, Math.min(box!.y + box!.height - 8, startY + deltaY));

  await terminal.evaluate(
    (element, gesture) => {
      const target = element as HTMLElement;
      const touch = (y: number, force = 0.5) =>
        new Touch({
          identifier: 11,
          target,
          clientX: gesture.x,
          clientY: y,
          pageX: gesture.x,
          pageY: y,
          screenX: gesture.x,
          screenY: y,
          radiusX: 8,
          radiusY: 8,
          rotationAngle: 0,
          force,
        });
      const dispatch = (type: 'touchstart' | 'touchmove' | 'touchend', active: Touch[], changed: Touch[]) =>
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: active,
            targetTouches: active,
            changedTouches: changed,
          }),
        );

      const start = touch(gesture.startY);
      dispatch('touchstart', [start], [start]);
      const steps = 6;
      let latest = start;
      for (let index = 1; index <= steps; index += 1) {
        latest = touch(gesture.startY + ((gesture.endY - gesture.startY) * index) / steps);
        dispatch('touchmove', [latest], [latest]);
      }
      dispatch('touchend', [], [touch(gesture.endY, 0)]);
    },
    { x, startY, endY },
  );
}

test('mobile single-finger drag follows native touch scrolling direction and returns to the live bottom', async ({
  page,
  context,
}) => {
  await connectMobileTerminal(page, context.request);
  const terminal = page.getByTestId('terminal');
  const rows = terminal.locator('.xterm-rows');
  const commandInput = page.getByTestId('command-input');

  await commandInput.fill(`i=1; while [ "$i" -le 120 ]; do printf 'MOBILE_SCROLL_%03d\\n' "$i"; i=$((i+1)); done`);
  await commandInput.press('Enter');
  await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain('MOBILE_SCROLL_120');

  await step('dragging downward scrolls back into older xterm output without reopening the keyboard', async () => {
    await swipeTerminal(page, 260);
    await expect.poll(async () => rows.innerText()).not.toContain('MOBILE_SCROLL_120');
    await expect.poll(async () => rows.innerText()).toMatch(/MOBILE_SCROLL_0\d\d/);
    expect((await terminalTextareaState(page)).active).toBe(false);
  });

  await step('dragging upward returns toward the live terminal bottom', async () => {
    await swipeTerminal(page, -320);
    await expect.poll(async () => rows.innerText()).toContain('MOBILE_SCROLL_120');
  });
});

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
  let originalTextareaState: Awaited<ReturnType<typeof terminalTextareaState>> | null = null;

  await step(
    'render a deterministic word and long-press without allowing the xterm textarea to raise the soft keyboard',
    async () => {
      await commandInput.fill(`printf '\\033[2J\\033[H\\n\\n\\n${marker}\\n'`);
      await commandInput.press('Enter');
      await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain(marker);
      originalTextareaState = await terminalTextareaState(page);
      expect(originalTextareaState.readOnly).toBe(false);
      const point = await terminalTextPoint(page, marker);
      await longPressTerminal(page, point, async () => {
        const duringHold = await terminalTextareaState(page);
        expect(duringHold.readOnly).toBe(true);
        expect(duringHold.inputMode).toBe('none');
      });
    },
  );

  await step('touch selection shows the mobile clipboard menu and both draggable handles', async () => {
    const menu = page.locator('.mobile-terminal-clipboard-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
    await expect(menu.getByRole('button', { name: 'Paste', exact: true })).toBeEnabled();
    await expect(menu.getByRole('button', { name: 'Select All', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Adjust selection start', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adjust selection end', exact: true })).toBeVisible();
    const textareaState = await terminalTextareaState(page);
    expect(textareaState.readOnly).toBe(true);
    expect(textareaState.inputMode).toBe('none');
    await captureFunctionalScreenshot(page, 'mobile-terminal-selection.png');
  });

  await step('Copy writes the exact selected terminal word without refocusing the soft-keyboard textarea', async () => {
    const menu = page.locator('.mobile-terminal-clipboard-menu');
    await menu.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator('.mobile-terminal-selection-handle')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(marker);
    expect(originalTextareaState).not.toBeNull();
    await page.waitForTimeout(200);
    const restored = await terminalTextareaState(page);
    expect(restored.readOnly).toBe(originalTextareaState!.readOnly);
    expect(restored.inputMode).toBe(originalTextareaState!.inputMode);
    expect(restored.active).toBe(false);
  });

  await step('a later short tap restores normal terminal keyboard focus once selection mode is over', async () => {
    const inner = page.getByTestId('terminal').getByTestId('terminal-inner');
    const box = await inner.boundingBox();
    expect(box).toBeTruthy();
    await page.touchscreen.tap(box!.x + Math.min(48, box!.width / 4), box!.y + Math.min(90, box!.height / 4));
    await expect.poll(async () => (await terminalTextareaState(page)).active).toBe(true);
    const focused = await terminalTextareaState(page);
    expect(focused.readOnly).toBe(false);
    expect(focused.inputMode).toBe(originalTextareaState!.inputMode);
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
