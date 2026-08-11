import { expect, test } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const CONTAINER_ID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function countFrames(frames: string[], type: string): number {
  return frames.filter((frame) => {
    try { return JSON.parse(frame)?.type === type; } catch { return false; }
  }).length;
}

test('Docker manager UI renders remote containers, stats, and executes a container action', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  const sentFrames: string[] = [];
  const receivedFrames: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => sentFrames.push(String(event.payload)));
    socket.on('framereceived', (event) => receivedFrames.push(String(event.payload)));
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
  });

  await step('expand shows live Docker stats returned through SSH', async () => {
    const manager = page.getByTestId('docker-manager');
    const row = manager.getByTestId(`docker-row-${CONTAINER_ID}`);
    // The Docker sidebar uses a card layout at its normal narrow width. The
    // desktop expand icon remains in the DOM but is CSS-hidden, so target the
    // currently accessible Expand action instead of that hidden element.
    await row.getByRole('button', { name: 'Expand', exact: true }).click();
    await expect(manager).toContainText('12.34%');
    await expect(manager).toContainText('32MiB / 2GiB');
    await expect(manager).toContainText('1.2MB / 800kB');
  });

  await slowStep('stop sends a Docker command and backend requests a fresh status after remote execution', async () => {
    const manager = page.getByTestId('docker-manager');
    const row = manager.getByTestId(`docker-row-${CONTAINER_ID}`);
    const refreshCount = countFrames(receivedFrames, 'request_docker_status_update');
    await row.getByTestId('docker-stop').click();

    await expect.poll(() => sentFrames.some((frame) => {
      try {
        const message = JSON.parse(frame);
        return message.type === 'docker:command' && message.payload?.command === 'stop' && message.payload?.containerId === CONTAINER_ID;
      } catch { return false; }
    }), { timeout: 15_000 }).toBeTruthy();

    await expect.poll(() => countFrames(receivedFrames, 'request_docker_status_update'), { timeout: 15_000 }).toBeGreaterThan(refreshCount);
  });
});
