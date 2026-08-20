import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const CONNECTION_NAME = 'E2E RDP RemoteApp';
const TEST_GATEWAY_URL = 'http://127.0.0.1:29090';

async function cleanupConnection(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/connections');
  expect(response.ok()).toBeTruthy();
  const connections = await response.json() as Array<{ id: number; name?: string }>;
  for (const connection of connections.filter(item => item.name === CONNECTION_NAME)) {
    expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
  }
}

test('RDP RemoteApp persists cleanly, forwards display-update settings, and supports browser fullscreen', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();
  await cleanupConnection(context.request);
  expect((await context.request.post(`${TEST_GATEWAY_URL}/control/reset`)).ok()).toBeTruthy();

  await page.addInitScript(() => {
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: function requestFullscreen() {
        fullscreenElement = this;
        document.dispatchEvent(new Event('fullscreenchange'));
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event('fullscreenchange'));
        return Promise.resolve();
      },
    });
  });

  let connectionId = 0;
  try {
    await page.goto('/connections');

    await step('RemoteApp stays out of the normal RDP path until explicitly enabled', async () => {
      await page.getByTestId('connections-add-button').click();
      const form = page.getByTestId('connection-form');
      await expect(form).toBeVisible();
      await form.getByTestId('connection-type-rdp').click();
      await expect(form.getByTestId('rdp-advanced-options')).toBeVisible();
      await expect(form.getByTestId('rdp-remote-app-fields')).toHaveCount(0);

      await form.locator('#conn-name').fill(CONNECTION_NAME);
      await form.locator('#conn-host').fill('192.0.2.77');
      await form.locator('#conn-port').fill('3389');
      await form.locator('#conn-username').fill('rdp-remoteapp-user');
      await form.locator('#conn-password-rdp').fill('rdp-remoteapp-password');

      await form.getByTestId('rdp-remote-app-toggle').click();
      await expect(form.getByTestId('rdp-remote-app-toggle')).toHaveAttribute('aria-checked', 'true');
      const remoteAppFields = form.getByTestId('rdp-remote-app-fields');
      await expect(remoteAppFields).toBeVisible();
      await form.getByTestId('rdp-remote-app-alias').fill('notepad');
      await form.getByTestId('rdp-remote-app-dir').fill('C:\\Work');
      await form.getByTestId('rdp-remote-app-args').fill('/A readme.txt');

      const createPromise = page.waitForResponse(response =>
        response.url().endsWith('/api/v1/connections') && response.request().method() === 'POST',
      );
      await form.getByTestId('connection-submit-button').click();
      const createResponse = await createPromise;
      expect(createResponse.status()).toBe(201);
      connectionId = (await createResponse.json() as { connection: { id: number } }).connection.id;
      await expect(form).toBeHidden({ timeout: 15_000 });

      const persisted = await context.request.get(`/api/v1/connections/${connectionId}`);
      expect(persisted.ok()).toBeTruthy();
      await expect(persisted.json()).resolves.toMatchObject({
        id: connectionId,
        type: 'RDP',
        rdp_options: {
          remote_app: 'notepad',
          remote_app_dir: 'C:\\Work',
          remote_app_args: '/A readme.txt',
        },
      });
    });

    await step('editing the RDP connection restores the optional RemoteApp controls', async () => {
      const row = page.getByTestId(`connection-row-${connectionId}`);
      await row.getByTestId('connection-row-edit').click();
      const form = page.getByTestId('connection-form');
      await expect(form.getByTestId('rdp-remote-app-toggle')).toHaveAttribute('aria-checked', 'true');
      await expect(form.getByTestId('rdp-remote-app-alias')).toHaveValue('notepad');
      await expect(form.getByTestId('rdp-remote-app-dir')).toHaveValue('C:\\Work');
      await expect(form.getByTestId('rdp-remote-app-args')).toHaveValue('/A readme.txt');
      await form.getByRole('button', { name: /cancel/i }).click();
      await expect(form).toBeHidden();
    });

    await step('RDP token generation forwards dynamic resize and RemoteApp parameters to the gateway', async () => {
      const session = await context.request.post(`/api/v1/connections/${connectionId}/rdp-session?width=1440&height=900&dpi=120`);
      expect(session.ok()).toBeTruthy();
      await expect(session.json()).resolves.toMatchObject({ token: 'e2e-remote-desktop-token' });

      await expect.poll(async () => {
        const response = await context.request.get(`${TEST_GATEWAY_URL}/control/latest`);
        if (!response.ok()) return null;
        return (await response.json() as { latestRequest: unknown }).latestRequest;
      }).toMatchObject({
        protocol: 'rdp',
        connectionConfig: {
          hostname: '192.0.2.77',
          port: '3389',
          width: '1440',
          height: '900',
          dpi: '120',
          resizeMethod: 'display-update',
          remoteApp: '||notepad',
          remoteAppDir: 'C:\\Work',
          remoteAppArgs: '/A readme.txt',
        },
      });
    });

    await step('Progress Display stays in normal layout and RDP always renders above it', async () => {
      await page.goto('/workspace');
      const progressToggle = page.getByTestId('transfer-progress-toggle');
      await expect(progressToggle).toBeVisible();
      await progressToggle.click();

      const progressDisplay = page.getByTestId('progress-display-modal');
      await expect(progressDisplay).toBeVisible();
      await expect(progressDisplay).toHaveAttribute('data-progress-display-placement', 'inline');
      await expect.poll(() => progressDisplay.evaluate(element => ({
        position: window.getComputedStyle(element).position,
        zIndex: window.getComputedStyle(element).zIndex,
      }))).toEqual({ position: 'static', zIndex: 'auto' });

      await page.getByTestId('terminal-tab-bar').getByTitle('New Connection Tab').click();
      const connectionList = page.getByTestId('workspace-connection-list');
      await expect(connectionList).toBeVisible();
      await connectionList.getByText(CONNECTION_NAME, { exact: true }).first().click();

      const modal = page.getByTestId('remote-desktop-modal');
      await expect(modal).toBeVisible();
      await expect(progressDisplay).toBeVisible();
      await expect.poll(async () => {
        const box = await modal.boundingBox();
        if (!box) return false;
        return modal.evaluate((element, point) => {
          const top = document.elementFromPoint(point.x, point.y);
          return Boolean(top && element.contains(top));
        }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      }).toBe(true);
    });

    await step('browser fullscreen is borderless, hides Nexus chrome, and Escape restores the window', async () => {
      const panel = page.getByTestId('remote-desktop-panel');
      const fullscreen = page.getByTestId('rdp-browser-fullscreen');
      const header = page.getByTestId('rdp-window-header');
      const footer = page.getByTestId('rdp-window-footer');
      await expect(fullscreen).toBeVisible();
      await expect(header).toBeVisible();
      await expect(footer).toBeVisible();

      const normalBox = await panel.boundingBox();
      expect(normalBox).toBeTruthy();
      const viewport = page.viewportSize();
      expect(viewport).toBeTruthy();

      await fullscreen.click();
      await expect.poll(() => panel.evaluate(element => document.fullscreenElement === element)).toBe(true);
      await expect(header).toBeHidden();
      await expect(footer).toBeHidden();
      const fullscreenBox = await panel.boundingBox();
      expect(fullscreenBox).toBeTruthy();
      expect(Math.abs(fullscreenBox!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(fullscreenBox!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(fullscreenBox!.width - viewport!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(fullscreenBox!.height - viewport!.height)).toBeLessThanOrEqual(1);
      await expect.poll(() => panel.evaluate(element => {
        const style = window.getComputedStyle(element);
        return {
          borderTopWidth: style.borderTopWidth,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
        };
      })).toEqual({ borderTopWidth: '0px', borderRadius: '0px', boxShadow: 'none' });

      await page.keyboard.press('Escape');
      await expect.poll(() => panel.evaluate(element => document.fullscreenElement === element)).toBe(false);
      await expect(header).toBeVisible();
      await expect(footer).toBeVisible();
      const restoredBox = await panel.boundingBox();
      expect(restoredBox).toBeTruthy();
      expect(restoredBox!.width).toBeLessThan(viewport!.width);
    });
  } finally {
    await cleanupConnection(context.request);
  }
});
