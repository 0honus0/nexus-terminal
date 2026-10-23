import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import {
	E2E_SSH,
	configureSshE2eSettings,
	createTestSshConnection,
	removeNamedSshConnections,
	resetTestSshFilesystem,
	trustTestSshHostKey,
} from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { readConnectionList } from '../../../../packages/shared/src/targets/connections/http-codec';
import {
	readHostKeyConfirmRequest,
	readHostKeyList,
} from '../../../../packages/shared/src/targets/host-keys/http-codec';
import { captureFunctionalScreenshot, functionalScreenshotsEnabled } from '../../support/functional-screenshots';
import { step, slowStep } from '../../support/steps';

for (const changedKey of [false, true]) {
	test(`SSH ${changedKey ? 'changed' : 'first'} host key keeps its tab after cancellation and reconnects after confirmation`, async ({
		page,
		context,
	}) => {
		await loginAsInitialAdmin(context.request);
		await configureSshE2eSettings(context.request);
		const fixture = await fetch(E2E_SSH.controlUrl + '/host-key');
		expect(fixture.ok).toBe(true);
		const actual = readHostKeyConfirmRequest(await fixture.json());
		const headers = { Origin: E2E_URLS.frontendOrigin };

		const readPin = async () => {
			const response = await context.request.get('/api/v1/targets/host-keys');
			expect(response.status()).toBe(200);
			return readHostKeyList(await response.json()).find(
				(item) => item.host === actual.host && item.port === actual.port,
			);
		};

		// The per-test reset starts without trust; do not assume deleting a missing pin succeeds.
		expect(await readPin()).toBeUndefined();
		const previousFingerprint = 'SHA256:' + (actual.fingerprint.endsWith('A') ? 'B' : 'A').repeat(43);
		if (changedKey) {
			const pinned = await context.request.post('/api/v1/targets/host-keys/confirm', {
				headers,
				data: { host: actual.host, port: actual.port, fingerprint: previousFingerprint },
			});
			expect(pinned.status()).toBe(201);
		}
		const connectionId = await createTestSshConnection(context.request, 'Host key confirmation');
		let connectRequests = 0;
		let trustWrites = 0;
		page.on('websocket', (socket) => {
			if (new URL(socket.url()).pathname !== '/ws/workspace') return;
			socket.on('framesent', ({ payload }) => {
				if (typeof payload !== 'string') return;
				const message: unknown = JSON.parse(payload);
				if (
					message &&
					typeof message === 'object' &&
					'type' in message &&
					message.type === 'workspace.connect'
				) {
					connectRequests += 1;
				}
			});
		});
		page.on('request', (request) => {
			if (
				new URL(request.url()).pathname === '/api/v1/targets/host-keys/confirm' &&
				request.method() === 'POST'
			) {
				trustWrites += 1;
			}
		});
		// Drop only the browser receipt after a real write to exercise read-only reconciliation.
		if (changedKey) {
			await page.route('**/api/v1/targets/host-keys/confirm', async (route) => {
				const response = await route.fetch();
				expect(response.status()).toBe(201);
				await route.abort('failed');
			});
		}

		await page.goto(`/workspace?connectionId=${connectionId}`);
		const dialog = page.getByRole('dialog', { name: 'SSH Host Keys', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog.locator('[data-dialog-details]')).toBeVisible();
		await expect(dialog).toContainText(actual.fingerprint);
		if (changedKey) await expect(dialog).toContainText(previousFingerprint);
		const tabs = page.locator('.terminal-tab-shell').getByRole('tab');
		await expect(tabs).toHaveCount(1);
		const sessionId = await tabs.getAttribute('data-session-id');
		expect(sessionId).toBeTruthy();
		if (!sessionId) throw new Error('Host key confirmation must belong to a real Workspace tab');
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(tabs).toHaveAttribute('data-session-status', 'host_key_untrusted');
		expect((await readPin())?.fingerprint ?? null).toBe(changedKey ? previousFingerprint : null);
		// Observe longer than the first reconnect backoff: cancellation must not reopen trust.
		await page.waitForTimeout(3_000);
		expect(connectRequests).toBe(1);
		expect(trustWrites).toBe(0);
		await expect(tabs).toHaveCount(1);
		await expect(dialog).toBeHidden();
		const input = page.locator('.terminal-inner-container:visible .xterm-helper-textarea');
		await input.focus();
		await page.keyboard.press('Enter');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Trust and reconnect', exact: true }).click();
		await expect(tabs).toHaveAttribute('data-session-state', 'connected', { timeout: 35_000 });
		await expect(tabs).toHaveCount(1);
		await expect(tabs).toHaveAttribute('data-session-id', sessionId);
		expect((await readPin())?.fingerprint).toBe(actual.fingerprint);
		expect(trustWrites).toBe(1);
		expect(connectRequests).toBe(3);
		const command = page.locator('.command-bar-command-input:visible');
		await expect(command).toBeEnabled();
		await command.fill("printf '%s%s\\n' 'HOST_KEY_CONFIRMED_' 'E2E'");
		await command.press('Enter');
		await expect
			.poll(() => page.locator('.terminal-inner-container:visible .xterm-rows').innerText())
			.toContain('HOST_KEY_CONFIRMED_E2E');
	});
}

test('adds, tests, and connects to a real SSH server', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await updateUiPreferences(context.request, (preferences) => {
		preferences.showPopupFileManager = false;
		preferences.showPopupFileEditor = false;
	});
	await resetTestSshFilesystem();
	await removeNamedSshConnections(context.request);
	await trustTestSshHostKey(context.request);

	await step('open add SSH connection form', async () => {
		await page.goto('/connections');
		await page.getByRole('button', { name: 'Add New Connection', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Add New Connection' })).toBeVisible();
	});

	await step('fill SSH password connection', async () => {
		await page.locator('#conn-name').fill(E2E_SSH.name);
		await page.locator('#conn-host').fill(E2E_SSH.host);
		await page.locator('#conn-port').fill(String(E2E_SSH.port));
		await page.locator('#conn-username').fill(E2E_SSH.username);
		await page.locator('#conn-password').fill(E2E_SSH.password);
	});

	await step('test unsaved SSH connection against real server', async () => {
		const responsePromise = page.waitForResponse(
			(response) =>
				response.url().includes('/api/v1/targets/connections/test-unsaved') &&
				response.request().method() === 'POST',
		);
		await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
		const response = await responsePromise;
		expect(response.ok()).toBeTruthy();
		// Browser navigation can invalidate the CDP response body. The actual
		// result must be rendered as Success by the UI, not merely return HTTP 200.
		const testResult = page.locator('form footer span.text-success');
		await expect(testResult).toBeVisible();
		await expect(testResult).toHaveClass(/text-success/);
		await expect(testResult).toContainText('Success');
	});

	await step('save SSH connection', async () => {
		const createPromise = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/v1/targets/connections/import') && response.request().method() === 'POST',
		);
		await page.locator('form button[type="submit"]').click();
		const response = await createPromise;
		expect(response.status()).toBe(200);
		// Creation goes through the bulk import owner and returns a per-item
		// receipt. Verify the persisted record without relying on a CDP body
		// that can disappear when the form closes or navigation begins.
		const saved = await page.request.get('/api/v1/targets/connections');
		expect(saved.ok()).toBeTruthy();
		expect(readConnectionList(await saved.json()).filter((item) => item.name === E2E_SSH.name)).toHaveLength(1);
		await expect(page.getByText(E2E_SSH.name, { exact: true }).first()).toBeVisible();
	});

	await slowStep('open real SSH session and SFTP file manager', async () => {
		const delayResponse = await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=1200`, { method: 'POST' });
		expect(delayResponse.ok).toBeTruthy();
		try {
			const row = page.getByText(E2E_SSH.name, { exact: true }).first().locator('xpath=ancestor::li');
			await row.getByRole('button', { name: 'Connect', exact: true }).click();
			await expect(page).toHaveURL(/\/workspace$/);
			await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-session-state', 'connected', {
				timeout: 10_000,
			});

			const initialLoading = page.locator('.file-manager-connection-state[role="status"]:visible');
			await expect(initialLoading).toHaveCount(1);
			await expect(page.locator('.file-manager-root table:visible')).toHaveCount(0);
			await expect(page.getByText('Directory is empty', { exact: true })).toHaveCount(0);
			await expect(page.locator('.file-manager-root table:visible tr[data-filename="seed.txt"]')).toBeVisible({
				timeout: 20_000,
			});
		} finally {
			const resetDelay = await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=0`, { method: 'POST' });
			expect(resetDelay.ok).toBeTruthy();
		}

		if (functionalScreenshotsEnabled()) {
			const terminal = page.getByRole('application', { name: 'Terminal', exact: true });
			const commandInput = page.locator('.command-bar-command-input');
			await expect(terminal).toBeVisible({ timeout: 20_000 });
			await expect(commandInput).toBeEnabled({ timeout: 20_000 });
			const embeddedFileManager = page.locator('.file-manager-root table').filter({ visible: true });
			await expect(embeddedFileManager).toHaveCount(1);
			await expect(embeddedFileManager.locator('tr[data-filename="seed.txt"]')).toBeVisible({ timeout: 20_000 });
			await expect(page.locator('.file-editor-container').filter({ visible: true })).toBeVisible();
			await commandInput.fill('clear');
			await commandInput.press('Enter');
			await commandInput.fill("printf 'Nexus Terminal documentation screenshot\\n'");
			await commandInput.press('Enter');
			await expect
				.poll(async () => terminal.locator('.xterm-rows').innerText(), { timeout: 15_000 })
				.toContain('Nexus Terminal documentation screenshot');
			await captureFunctionalScreenshot(page, 'ssh-terminal.png', { viewport: { width: 1440, height: 900 } });
		}

		const embeddedFileManager = page.locator('.file-manager-root table').filter({ visible: true });
		await expect(embeddedFileManager.locator('tr[data-filename="seed.txt"]')).toBeVisible({ timeout: 20_000 });
	});
});

test('Connect All waits for each Workspace binding before mounted file managers request SFTP', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();

	const prefix = `E2E Connect All Race ${Date.now()}`;
	const connectionIds: number[] = [];
	const protocolErrors: string[] = [];

	await trustTestSshHostKey(context.request);
	try {
		connectionIds.push(
			await createTestSshConnection(context.request, prefix + ' A'),
			await createTestSshConnection(context.request, prefix + ' B'),
		);
		page.on('websocket', (socket) => {
			socket.on('framereceived', ({ payload }) => {
				if (typeof payload !== 'string') return;
				if (payload.includes('protocol.error') || payload.includes('Workspace session'))
					protocolErrors.push(payload);
			});
		});

		await page.goto('/connections');
		await page.getByPlaceholder('Search connections...').fill(prefix);
		await expect(page.locator('.connection-card')).toHaveCount(2);
		await page.getByRole('button', { name: 'Connect All', exact: true }).click();
		await expect(page).toHaveURL(/\/workspace$/);

		const tabs = page.getByRole('tab');
		await expect(tabs).toHaveCount(2, { timeout: 20_000 });
		await expect
			.poll(() => tabs.evaluateAll((items) => items.map((item) => item.getAttribute('data-session-state'))), {
				timeout: 40_000,
			})
			.toEqual(['connected', 'connected']);
		await expect
			.poll(() =>
				tabs.evaluateAll((items) => items.map((item) => item.getAttribute('data-session-status') ?? '')),
			)
			.toEqual(['', '']);

		const firstTab = tabs.filter({ hasText: `${prefix} A` });
		const secondTab = tabs.filter({ hasText: `${prefix} B` });
		const visibleSurfaces = page.locator('[data-workspace-surface]:visible');
		await expect(visibleSurfaces).toHaveCount(1);
		await expect(visibleSurfaces).toHaveAttribute(
			'data-workspace-id',
			(await page.getByRole('tab', { selected: true }).getAttribute('data-session-id')) ?? '',
		);
		await firstTab.click();
		await expect(firstTab).toHaveAttribute('aria-selected', 'true');
		await expect(visibleSurfaces).toHaveCount(1);
		await expect(visibleSurfaces).toHaveAttribute(
			'data-workspace-id',
			(await firstTab.getAttribute('data-session-id')) ?? '',
		);
		const commandInput = page.locator('.command-bar-command-input:visible').first();
		await expect(commandInput).toBeEnabled();
		await commandInput.fill('for i in $(seq 1 80); do echo NEXUS_BACKGROUND_BATCH_$i; sleep 0.03; done');
		await commandInput.press('Enter');
		await page.waitForTimeout(120);
		await secondTab.click();
		await expect(secondTab).toHaveAttribute('aria-selected', 'true');
		await expect(visibleSurfaces).toHaveCount(1);
		await expect(visibleSurfaces).toHaveAttribute(
			'data-workspace-id',
			(await secondTab.getAttribute('data-session-id')) ?? '',
		);
		await page.waitForTimeout(2_800);
		await firstTab.click();
		await expect(firstTab).toHaveAttribute('aria-selected', 'true');
		await expect
			.poll(() => page.locator('.terminal-inner-container:visible .xterm-rows').innerText(), { timeout: 10_000 })
			.toContain('NEXUS_BACKGROUND_BATCH_80');

		expect(
			protocolErrors.filter(
				(message) => message.includes('Workspace session') && message.includes('was not found'),
			),
		).toEqual([]);
	} finally {
		for (const id of connectionIds) {
			const response = await context.request.delete(`/api/v1/targets/connections/${id}`, {
				headers: { Origin: E2E_URLS.frontendOrigin },
			});
			expect([200, 204, 404]).toContain(response.status());
		}
	}
});
