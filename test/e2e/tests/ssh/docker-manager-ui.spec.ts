import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const CONTAINER_ID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const hasFrame = (frames: string[], predicate: (message: any) => boolean): boolean =>
  frames.some((frame) => {
    try {
      return predicate(JSON.parse(frame));
    } catch {
      return false;
    }
  });

test('Docker manager UI renders remote containers, stats, and executes a container action', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await page.setViewportSize({ width: 1440, height: 900 });
  const settings = await context.request.put('/api/v1/settings', {
    data: { dockerStatusIntervalSeconds: 1, dockerDefaultExpand: true },
  });
  expect(settings.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  const sentFrames: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => sentFrames.push(String(event.payload)));
  });

  await connectTestSshFromConnectionsPage(page, connectionId);

  await step('the baseline sidebar behavior auto-collapses when the workspace is clicked', async () => {
    await page.getByTestId('sidebar-pane-connections').click();
    const sidebar = page.getByTestId('left-sidebar-panel');
    await expect(sidebar).toBeVisible();
    await page.getByTestId('terminal').click();
    await expect(sidebar).toBeHidden();
  });

  await slowStep('open Docker manager and render the deterministic remote container', async () => {
    await page.getByTestId('sidebar-pane-dockerManager').click();
    const manager = page.getByTestId('docker-manager');
    await expect(manager).toBeVisible();
    const row = manager.getByTestId(`docker-row-${CONTAINER_ID}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('nexus-e2e-container');
    await expect(row).toContainText('alpine:latest');
    await expect(row).toContainText('Up 10 minutes');
    await expect(row.locator('i.fa-play')).toBeVisible();
    await expect(row.locator('i.fa-stop')).toBeVisible();
    await expect(row.locator('i.fa-sync-alt')).toBeVisible();
    await expect(row.locator('i.fa-trash-alt')).toBeVisible();
    await expect(row.locator('i.fa-terminal')).toBeVisible();
    await expect(row.locator('i.fa-file-alt')).toBeVisible();
    await expect(row.getByTestId('docker-expand')).toHaveAttribute('aria-label', 'Collapse');

    const sidebar = page.getByTestId('left-sidebar-panel');
    await expect(sidebar).toBeVisible();
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(349);
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).not.toBeNull();
    if (!sidebarBox) throw new Error('Docker sidebar has no geometry');
    expect(
      await manager.evaluate((element) => getComputedStyle(element.parentElement as HTMLElement).borderTopWidth),
    ).toBe('0px');
    await captureFunctionalScreenshot(page, 'docker-manager-sidebar-running.png');

    const handle = page.getByTestId('left-sidebar-resize-handle');
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) throw new Error('Docker sidebar resize handle has no geometry');
    const resizeStartX = handleBox.x + handleBox.width / 2;
    const resizeY = handleBox.y + Math.min(100, handleBox.height / 2);
    await page.mouse.move(resizeStartX, resizeY);
    await page.mouse.down();
    await page.mouse.move(resizeStartX + (300 - sidebarBox.width), resizeY, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(300);

    const narrowLayout = await row.evaluate((element) => {
      const cell = element.querySelector<HTMLElement>('.docker-cell');
      const actions = element.querySelector<HTMLElement>('.docker-actions');
      const cardFooter = element.querySelector<HTMLElement>('.docker-card-expand-cell');
      if (!cell || !actions || !cardFooter) return null;
      const label = getComputedStyle(cell, '::before');
      return {
        rowPaddingTop: getComputedStyle(element).paddingTop,
        textAlign: getComputedStyle(cell).textAlign,
        labelPosition: label.position,
        actionsJustify: getComputedStyle(actions).justifyContent,
        cardFooterMarginTop: getComputedStyle(cardFooter).marginTop,
      };
    });
    expect(narrowLayout).toEqual({
      rowPaddingTop: '12px',
      textAlign: 'right',
      labelPosition: 'absolute',
      actionsJustify: 'flex-end',
      cardFooterMarginTop: '12px',
    });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
    await captureFunctionalScreenshot(page, 'docker-manager-sidebar-narrow.png');

    const countStatusFrames = () =>
      sentFrames.reduce((count, frame) => {
        try {
          const message = JSON.parse(frame) as { type?: string };
          return count + (message.type === 'docker.status' ? 1 : 0);
        } catch {
          return count;
        }
      }, 0);
    await expect.poll(countStatusFrames, { timeout: 2500 }).toBeGreaterThanOrEqual(2);
  });

  await step(
    'the default-expand preference is applied and users can collapse then restore live Docker stats',
    async () => {
      const manager = page.getByTestId('docker-manager');
      const row = manager.getByTestId(`docker-row-${CONTAINER_ID}`);
      await expect(manager).toContainText('12.34%');
      const collapse = row.getByRole('button', { name: 'Collapse', exact: true }).filter({ visible: true }).first();
      await expect(collapse).toBeVisible();
      await collapse.click();
      const expand = row.getByRole('button', { name: 'Expand', exact: true }).filter({ visible: true }).first();
      await expect(expand).toBeVisible();
      await expand.click();
      await expect(
        row.getByRole('button', { name: 'Collapse', exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();
      await expect(manager).toContainText('12.34%');
      await expect(manager).toContainText('32MiB / 2GiB');
      await expect(manager).toContainText('1.2MB / 800kB');
    },
  );

  await step('Enter and Logs route terminal command intents through the owning Workspace session', async () => {
    const row = page.getByTestId('docker-manager').getByTestId(`docker-row-${CONTAINER_ID}`);
    await row.getByRole('button', { name: 'Enter', exact: true }).click();
    await expect
      .poll(() =>
        hasFrame(
          sentFrames,
          (message) =>
            message.type === 'terminal.input' && message.payload?.data === `docker exec -it ${CONTAINER_ID} sh\r`,
        ),
      )
      .toBeTruthy();

    await row.getByRole('button', { name: 'Logs', exact: true }).click();
    await expect
      .poll(() =>
        hasFrame(
          sentFrames,
          (message) =>
            message.type === 'terminal.input' &&
            message.payload?.data === `docker logs --tail 1000 -f ${CONTAINER_ID}\r`,
        ),
      )
      .toBeTruthy();
  });

  await slowStep('restart, stop, and start refresh the container state after real remote Docker commands', async () => {
    const manager = page.getByTestId('docker-manager');
    const row = manager.getByTestId(`docker-row-${CONTAINER_ID}`);

    await row.getByRole('button', { name: 'Restart', exact: true }).click();
    await expect
      .poll(() =>
        hasFrame(
          sentFrames,
          (message) =>
            message.type === 'docker.command' &&
            message.payload?.command === 'restart' &&
            message.payload?.containerId === CONTAINER_ID,
        ),
      )
      .toBeTruthy();

    await row.getByTestId('docker-stop').click();
    await expect
      .poll(
        () =>
          hasFrame(
            sentFrames,
            (message) =>
              message.type === 'docker.command' &&
              message.payload?.command === 'stop' &&
              message.payload?.containerId === CONTAINER_ID,
          ),
        { timeout: 15_000 },
      )
      .toBeTruthy();
    await expect(row).toContainText('Exited (0) 1 second ago', { timeout: 15_000 });
    await expect(row.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
    await expect(row.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
    await expect(row.getByRole('button', { name: 'Restart', exact: true })).toBeDisabled();

    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect
      .poll(() =>
        hasFrame(
          sentFrames,
          (message) =>
            message.type === 'docker.command' &&
            message.payload?.command === 'start' &&
            message.payload?.containerId === CONTAINER_ID,
        ),
      )
      .toBeTruthy();
    await expect(row).toContainText('Up 10 minutes', { timeout: 15_000 });
  });

  await slowStep('remove is destructive-confirmed and the accepted action refreshes the container away', async () => {
    const manager = page.getByTestId('docker-manager');
    const row = manager.getByTestId(`docker-row-${CONTAINER_ID}`);
    const removeButton = row.getByRole('button', { name: 'Remove', exact: true });
    const removeFrame = (message: any) =>
      message.type === 'docker.command' &&
      message.payload?.command === 'remove' &&
      message.payload?.containerId === CONTAINER_ID;

    await removeButton.click();
    const firstConfirm = page.getByRole('dialog', { name: 'Please confirm' });
    await expect(firstConfirm).toBeVisible();
    await expect(firstConfirm).toContainText('nexus-e2e-container');
    await firstConfirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(firstConfirm).toBeHidden();
    expect(hasFrame(sentFrames, removeFrame)).toBeFalsy();

    await removeButton.click();
    const confirm = page.getByRole('dialog', { name: 'Please confirm' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(() => hasFrame(sentFrames, removeFrame), { timeout: 15_000 }).toBeTruthy();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
    await expect(manager).toContainText('No running or stopped containers found on remote host.', { timeout: 15_000 });
  });
});

test('Workspace layout lock and top-navigation toggle affect the live shell and persist', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await context.request.put('/api/v1/settings', { data: { layoutLocked: false } })).ok()).toBeTruthy();
  expect(
    (
      await context.request.put('/api/v1/settings/nav-bar-visibility', {
        data: { visible: true },
      })
    ).ok(),
  ).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  try {
    await connectTestSshFromConnectionsPage(page, connectionId);

    const rootSplit = page.locator('.workspace-split.splitpanes--vertical').first();
    const firstPane = rootSplit.locator(':scope > .splitpanes__pane').first();
    const firstSplitter = rootSplit.locator(':scope > .splitpanes__splitter').first();
    await expect(rootSplit).toBeVisible();
    await expect(firstSplitter).toBeVisible();

    await step('an unlocked layout splitter remains draggable', async () => {
      const before = await firstPane.boundingBox();
      const splitterBox = await firstSplitter.boundingBox();
      expect(before).toBeTruthy();
      expect(splitterBox).toBeTruthy();
      await page.mouse.move(splitterBox!.x + splitterBox!.width / 2, splitterBox!.y + splitterBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(splitterBox!.x + 80, splitterBox!.y + splitterBox!.height / 2, { steps: 8 });
      await page.mouse.up();
      await expect
        .poll(async () => Math.abs(((await firstPane.boundingBox())?.width ?? 0) - before!.width))
        .toBeGreaterThan(20);
    });

    await step('locking from the real layout configurator prevents splitter edits', async () => {
      await page.getByTestId('terminal-tab-bar').getByRole('button', { name: 'Configure Layout', exact: true }).click();
      const lockSwitch = page.getByRole('switch', { name: 'Lock Layout', exact: true });
      await expect(lockSwitch).toHaveAttribute('aria-checked', 'false');
      await lockSwitch.click();
      await expect(lockSwitch).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/settings');
          const settings = (await response.json()) as Record<string, unknown>;
          return settings.layoutLocked;
        })
        .toBe(true);
      const configurator = page.getByRole('dialog', { name: 'Layout Configurator', exact: true });
      await configurator.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(configurator).toBeHidden();

      const before = await firstPane.boundingBox();
      const splitterBox = await firstSplitter.boundingBox();
      expect(before).toBeTruthy();
      expect(splitterBox).toBeTruthy();
      await page.mouse.move(splitterBox!.x + splitterBox!.width / 2, splitterBox!.y + splitterBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(splitterBox!.x + 80, splitterBox!.y + splitterBox!.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const after = await firstPane.boundingBox();
      expect(after).toBeTruthy();
      expect(Math.abs(after!.width - before!.width)).toBeLessThan(2);
    });

    await step('the tab-bar eye action hides and restores the persisted top navigation', async () => {
      const tabBar = page.getByTestId('terminal-tab-bar');
      const header = page.locator('#app > div > header');
      await expect(header).toBeVisible();
      await tabBar.getByRole('button', { name: 'Hide', exact: true }).click();
      await expect(header).toHaveCount(0);
      await expect(tabBar.getByRole('button', { name: 'Show Top Navigation', exact: true })).toBeVisible();
      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/settings/nav-bar-visibility');
          return ((await response.json()) as { visible: boolean }).visible;
        })
        .toBe(false);

      await tabBar.getByRole('button', { name: 'Show Top Navigation', exact: true }).click();
      await expect(header).toBeVisible();
      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/settings/nav-bar-visibility');
          return ((await response.json()) as { visible: boolean }).visible;
        })
        .toBe(true);
    });
  } finally {
    await context.request.put('/api/v1/settings', { data: { layoutLocked: false } });
    await context.request.put('/api/v1/settings/nav-bar-visibility', { data: { visible: true } });
  }
});
