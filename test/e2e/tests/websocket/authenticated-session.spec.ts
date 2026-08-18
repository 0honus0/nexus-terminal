import { expect, test } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';

test.describe('authenticated WebSocket', () => {
  test('rejects a WebSocket upgrade without a login session', async ({ page }) => {
    await page.goto('/login');

    const outcome = await page.evaluate(async () => {
      return await new Promise<'opened' | 'rejected' | 'timeout'>((resolve) => {
        const socket = new WebSocket('ws://127.0.0.1:4173/ws');
        const timeout = window.setTimeout(() => {
          socket.close();
          resolve('timeout');
        }, 5_000);

        socket.addEventListener('open', () => {
          window.clearTimeout(timeout);
          socket.close();
          resolve('opened');
        }, { once: true });
        socket.addEventListener('error', () => {
          window.clearTimeout(timeout);
          resolve('rejected');
        }, { once: true });
      });
    });

    expect(outcome).toBe('rejected');
  });

  test('accepts the authenticated session and routes WebSocket frames', async ({ page, context }) => {
    await loginAsInitialAdmin(context.request);
    await page.goto('/');

    const observedFrames: Array<{ direction: 'sent' | 'received'; payload: string | Buffer }> = [];
    page.on('websocket', (socket) => {
      socket.on('framesent', (event) => observedFrames.push({ direction: 'sent', payload: event.payload }));
      socket.on('framereceived', (event) => observedFrames.push({ direction: 'received', payload: event.payload }));
    });

    const response = await page.evaluate(async () => {
      return await new Promise<{ type?: string; payload?: unknown }>((resolve, reject) => {
        const socket = new WebSocket('ws://127.0.0.1:4173/ws');
        const timeout = window.setTimeout(() => {
          socket.close();
          reject(new Error('Timed out waiting for WebSocket response'));
        }, 5_000);

        socket.addEventListener('open', () => socket.send('not-json'), { once: true });
        socket.addEventListener('message', (event) => {
          window.clearTimeout(timeout);
          socket.close();
          resolve(JSON.parse(String(event.data)) as { type?: string; payload?: unknown });
        }, { once: true });
        socket.addEventListener('error', () => {
          window.clearTimeout(timeout);
          reject(new Error('Authenticated WebSocket failed to open'));
        }, { once: true });
      });
    });

    expect(response.type).toBe('error');
    expect(observedFrames.some((frame) => frame.direction === 'sent' && frame.payload === 'not-json')).toBeTruthy();
    expect(observedFrames.some((frame) => frame.direction === 'received')).toBeTruthy();
  });
});
