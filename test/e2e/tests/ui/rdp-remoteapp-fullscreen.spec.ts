import { expect, test, type APIRequestContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const CONNECTION_NAME = 'E2E RDP RemoteApp';

async function cleanupConnection(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/connections');
  expect(response.ok()).toBeTruthy();
  const connections = (await response.json()) as Array<{ id: number; name?: string }>;
  for (const connection of connections.filter((item) => item.name === CONNECTION_NAME)) {
    expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
  }
}

test('RDP RemoteApp persists cleanly, forwards display-update settings, and supports browser fullscreen', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();
  await cleanupConnection(context.request);

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

      const createPromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/connections') && response.request().method() === 'POST',
      );
      await form.getByTestId('connection-submit-button').click();
      const createResponse = await createPromise;
      expect(createResponse.status()).toBe(201);
      connectionId = ((await createResponse.json()) as { connection: { id: number } }).connection.id;
      await expect(form).toBeHidden({ timeout: 15_000 });

      const persisted = await context.request.get(`/api/v1/connections/${connectionId}`);
      expect(persisted.ok()).toBeTruthy();
      await expect(persisted.json()).resolves.toMatchObject({
        id: connectionId,
        type: 'RDP',
        rdpOptions: {
          remoteApp: 'notepad',
          remoteAppDirectory: 'C:\\Work',
          remoteAppArguments: '/A readme.txt',
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

    await step('RDP token generation succeeds with the persisted RemoteApp settings', async () => {
      const session = await context.request.post(
        `/api/v1/connections/${connectionId}/rdp-session?width=1440&height=900&dpi=120`,
      );
      expect(session.ok()).toBeTruthy();
      await expect(session.json()).resolves.toMatchObject({ token: 'e2e-remote-desktop-token' });
    });

    await step('RDP opens from the clean Workspace without rendering an empty Progress Display', async () => {
      await page.goto('/workspace');
      await expect(page.getByTestId('transfer-progress-toggle')).toHaveCount(0);

      const connectionList = page.getByTestId('workspace-connection-list');
      await expect(connectionList).toBeVisible();
      await connectionList.getByText(CONNECTION_NAME, { exact: true }).first().click();

      const modal = page.getByTestId('remote-desktop-modal');
      await expect(modal).toBeVisible();
      await expect(page.getByTestId('progress-display-modal')).toHaveCount(0);
    });

    await step('browser fullscreen is borderless, hides Nexus chrome, and Escape restores the window', async () => {
      const panel = page.getByTestId('remote-desktop-panel');
      const fullscreen = panel.getByRole('button', { name: 'Fullscreen', exact: true });
      const header = page.getByTestId('rdp-window-header');
      const footer = page.getByTestId('rdp-window-footer');
      await expect(panel).toBeVisible();
      await expect(fullscreen).toBeVisible();
      await expect(header).toBeVisible();
      await expect(footer).toBeVisible();

      const normalBox = await panel.boundingBox();
      expect(normalBox).toBeTruthy();
      const viewport = page.viewportSize();
      expect(viewport).toBeTruthy();

      await fullscreen.click();
      await expect.poll(() => panel.evaluate((element) => document.fullscreenElement === element)).toBe(true);
      await expect(header).toBeHidden();
      await expect(footer).toBeHidden();
      const fullscreenBox = await panel.boundingBox();
      expect(fullscreenBox).toBeTruthy();
      expect(Math.abs(fullscreenBox!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(fullscreenBox!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(fullscreenBox!.width - viewport!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(fullscreenBox!.height - viewport!.height)).toBeLessThanOrEqual(1);
      await expect
        .poll(() =>
          panel.evaluate((element) => {
            const style = window.getComputedStyle(element);
            return {
              borderTopWidth: style.borderTopWidth,
              borderRadius: style.borderRadius,
              boxShadow: style.boxShadow,
            };
          }),
        )
        .toEqual({ borderTopWidth: '0px', borderRadius: '0px', boxShadow: 'none' });

      await page.keyboard.press('Escape');
      await expect.poll(() => panel.evaluate((element) => document.fullscreenElement === element)).toBe(false);
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

const POINTER_RDP_NAME = 'E2E RDP Pointer Interactions';
const POINTER_VNC_NAME = 'E2E VNC Pointer Interactions';

async function createRemoteConnection(
  request: APIRequestContext,
  type: 'RDP' | 'VNC',
  name: string,
  host: string,
  port: number,
): Promise<number> {
  const response = await request.post('/api/v1/connections', {
    data: {
      type,
      name,
      host,
      port,
      username: `${type.toLowerCase()}-pointer-user`,
      password: `${type.toLowerCase()}-pointer-password`,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { connection: { id: number } }).connection.id;
}

async function openRemoteConnection(page: Page, name: string, modalTestId: string): Promise<void> {
  await page.goto('/workspace');
  const connectionList = page.getByTestId('workspace-connection-list');
  await expect(connectionList).toBeVisible();
  await connectionList.getByText(name, { exact: true }).first().click();
  await expect(page.getByTestId(modalTestId)).toBeVisible();
}

async function dragBy(page: Page, testId: string, deltaX: number, deltaY: number): Promise<void> {
  const target = page.getByTestId(testId);
  const box = await target.boundingBox();
  expect(box).toBeTruthy();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  const pointerId = 7;

  // Dispatch pointer-only input so this fails if the shared interaction regresses back
  // to mouse-specific listeners. A pen pointer also covers the non-mouse path explicitly.
  await target.dispatchEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId,
    pointerType: 'pen',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: startX,
    clientY: startY,
  });
  await page.evaluate(
    ({ x, y, id }) => {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: 'pen',
          isPrimary: true,
          buttons: 1,
          clientX: x,
          clientY: y,
        }),
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: 'pen',
          isPrimary: true,
          button: 0,
          buttons: 0,
          clientX: x,
          clientY: y,
        }),
      );
    },
    { x: startX + deltaX, y: startY + deltaY, id: pointerId },
  );
}

async function exercisePointerWindow(
  page: Page,
  ids: {
    panel: string;
    resize: string;
    minimize: string;
    restore: string;
  },
): Promise<void> {
  const panel = page.getByTestId(ids.panel);
  await expect(panel).toBeVisible();

  const initialPanelBox = await panel.boundingBox();
  expect(initialPanelBox).toBeTruthy();
  await dragBy(page, ids.resize, 120, 90);
  await expect.poll(async () => panel.boundingBox()).not.toBeNull();
  const resizedPanelBox = await panel.boundingBox();
  expect(resizedPanelBox).toBeTruthy();
  expect(resizedPanelBox!.width).toBeGreaterThan(initialPanelBox!.width + 60);
  expect(resizedPanelBox!.height).toBeGreaterThan(initialPanelBox!.height + 40);

  await page.getByTestId(ids.minimize).click();
  await expect(panel).toBeHidden();
  const restore = page.getByTestId(ids.restore);
  await expect(restore).toBeVisible();
  const initialRestoreBox = await restore.boundingBox();
  expect(initialRestoreBox).toBeTruthy();

  await dragBy(page, ids.restore, 140, 80);
  await expect(panel).toBeHidden();
  const movedRestoreBox = await restore.boundingBox();
  expect(movedRestoreBox).toBeTruthy();
  expect(movedRestoreBox!.x).toBeGreaterThan(initialRestoreBox!.x + 80);
  expect(movedRestoreBox!.y).toBeGreaterThan(initialRestoreBox!.y + 40);

  // Browsers normally emit a click after a pointer drag on the same moving button.
  // That click must be swallowed once, while the next intentional click restores it.
  await restore.dispatchEvent('click');
  await expect(panel).toBeHidden();
  await restore.click();
  await expect(panel).toBeVisible();
  await expect(restore).toBeHidden();
}

test('RDP pointer resize and restore-button dragging preserve minimized window behavior', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await page.setViewportSize({ width: 1600, height: 1100 });
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: {
          language: 'en-US',
          rdpModalWidth: 1024,
          rdpModalHeight: 768,
        },
      })
    ).ok(),
  ).toBeTruthy();

  const connectionId = await createRemoteConnection(context.request, 'RDP', POINTER_RDP_NAME, '192.0.2.91', 3389);
  try {
    await openRemoteConnection(page, POINTER_RDP_NAME, 'remote-desktop-modal');
    await exercisePointerWindow(page, {
      panel: 'remote-desktop-panel',
      resize: 'rdp-window-resize',
      minimize: 'rdp-window-minimize',
      restore: 'rdp-window-restore',
    });
    const modal = page.getByTestId('remote-desktop-modal');
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(modal).toBeHidden();
  } finally {
    await context.request.delete(`/api/v1/connections/${connectionId}`);
  }
});

test('VNC pointer resize and restore-button dragging share the same window semantics', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await page.setViewportSize({ width: 1600, height: 1100 });
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: {
          language: 'en-US',
          vncModalWidth: 900,
          vncModalHeight: 650,
        },
      })
    ).ok(),
  ).toBeTruthy();

  const connectionId = await createRemoteConnection(context.request, 'VNC', POINTER_VNC_NAME, '192.0.2.92', 5901);
  try {
    await openRemoteConnection(page, POINTER_VNC_NAME, 'vnc-modal');
    await exercisePointerWindow(page, {
      panel: 'vnc-panel',
      resize: 'vnc-window-resize',
      minimize: 'vnc-window-minimize',
      restore: 'vnc-window-restore',
    });
    const modal = page.getByTestId('vnc-modal');
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(modal).toBeHidden();
  } finally {
    await context.request.delete(`/api/v1/connections/${connectionId}`);
  }
});
