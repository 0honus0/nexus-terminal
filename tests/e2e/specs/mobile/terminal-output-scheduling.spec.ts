import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { configureSshE2eSettings, connectTestSshFromConnectionsPage, ensureTestSshConnection } from '../../support/ssh';

test('visible mobile terminal consumes SSH output while animation frames are deferred', async ({ page, context }) => {
  let consumedBytes = 0;
  let receivedBytes = 0;
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') receivedBytes += payload.length;
    });
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string') return;
      const message = JSON.parse(payload);
      if (message.type === 'terminal.flow') consumedBytes = message.payload.consumedBytes;
    });
  });
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  const terminal = page.locator('.terminal-inner-container');
  await expect(terminal).toBeVisible();
  const command = page.locator('.command-bar-command-input');
  await command.fill("printf 'SCHEDULING_%s\\n' READY");
  await command.press('Enter');
  await expect(terminal.locator('.xterm-rows')).toContainText('SCHEDULING_READY');
  const baseline = consumedBytes;
  const receivedBaseline = receivedBytes;
  // Keep the real transport and timers running. Defer only subsequently
  // requested animation frames, as a controlled browser scheduling fault.
  await page.evaluate(() => {
    const original = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const deferred = new Map<number, FrameRequestCallback>();
    let id = -1;
    const state = window as typeof window & { restoreFrames?: () => void };
    window.requestAnimationFrame = (callback) => {
      const handle = id--;
      deferred.set(handle, callback);
      return handle;
    };
    window.cancelAnimationFrame = (handle) => {
      if (handle < 0) deferred.delete(handle);
      else originalCancel.call(window, handle);
    };
    state.restoreFrames = () => {
      window.requestAnimationFrame = original;
      window.cancelAnimationFrame = originalCancel;
      for (const callback of deferred.values()) original.call(window, callback);
      deferred.clear();
      delete state.restoreFrames;
    };
  });
  try {
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    // Keyboard input does not wait for animation-frame-based actionability.
    await command.fill("printf '%4096s\\nSCHEDULING_%s\\n' '' TIMER_DRAINED");
    await page.keyboard.press('Enter');
    await expect.poll(() => receivedBytes).toBeGreaterThanOrEqual(receivedBaseline + 4096);
    await expect.poll(() => consumedBytes).toBeGreaterThanOrEqual(baseline + 4096);
  } finally {
    await page.evaluate(() => {
      const state = window as typeof window & { restoreFrames?: () => void };
      state.restoreFrames?.();
      window.dispatchEvent(new Event('focus'));
    });
  }
  await expect(terminal.locator('.xterm-rows')).toContainText('SCHEDULING_TIMER_DRAINED');
  await command.fill("printf 'SCHEDULING_%s\\n' RECOVERED");
  await command.press('Enter');
  await expect(terminal.locator('.xterm-rows')).toContainText('SCHEDULING_RECOVERED');
});
