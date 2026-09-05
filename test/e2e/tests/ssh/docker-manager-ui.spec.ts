import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const CONTAINER_ID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('Docker manager UI renders remote containers, stats, and executes a container action', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  const sentFrames: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => sentFrames.push(String(event.payload)));
  });

  await connectTestSshFromConnectionsPage(page, connectionId);

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
  });

  await step('the restored narrow card footer expands live Docker stats returned through SSH', async () => {
    const manager = page.getByTestId('docker-manager');
    const row = manager.getByTestId(`docker-row-${CONTAINER_ID}`);
    const expand = row.getByRole('button', { name: 'Expand', exact: true });
    await expect(expand.locator('i.fa-chevron-down')).toBeVisible();
    await expand.click();
    await expect(manager).toContainText('12.34%');
    await expect(manager).toContainText('32MiB / 2GiB');
    await expect(manager).toContainText('1.2MB / 800kB');
  });

  await slowStep('stop sends the container action through the user WebSocket protocol', async () => {
    const manager = page.getByTestId('docker-manager');
    const row = manager.getByTestId(`docker-row-${CONTAINER_ID}`);
    await row.getByTestId('docker-stop').click();

    await expect
      .poll(
        () =>
          sentFrames.some((frame) => {
            try {
              const message = JSON.parse(frame);
              return (
                message.type === 'docker.command' &&
                message.payload?.command === 'stop' &&
                message.payload?.containerId === CONTAINER_ID
              );
            } catch {
              return false;
            }
          }),
        { timeout: 15_000 },
      )
      .toBeTruthy();
  });
});
