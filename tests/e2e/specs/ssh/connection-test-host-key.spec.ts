import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, configureSshE2eSettings, createTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { readConnectionList } from '../../../../packages/shared/src/targets/connections/http-codec';
import {
	readHostKeyConfirmRequest,
	readHostKeyList,
} from '../../../../packages/shared/src/targets/host-keys/http-codec';

for (const changed of [false, true]) {
	test(`saved SSH test confirms ${changed ? 'changed' : 'first'} host key without opening a terminal`, async ({
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

		expect(await readPin()).toBeUndefined();
		const previous = 'SHA256:' + (actual.fingerprint.endsWith('A') ? 'B' : 'A').repeat(43);
		if (changed) {
			const pinned = await context.request.post('/api/v1/targets/host-keys/confirm', {
				headers,
				data: { host: actual.host, port: actual.port, fingerprint: previous },
			});
			expect(pinned.status()).toBe(201);
		}
		const id = await createTestSshConnection(context.request, 'SSH test trust');
		let attempts = 0;
		let trustWrites = 0;
		page.on('request', (request) => {
			if (request.method() !== 'POST') return;
			const path = new URL(request.url()).pathname;
			if (path === `/api/v1/targets/connections/${id}/test`) attempts++;
			if (path === '/api/v1/targets/host-keys/confirm') trustWrites++;
		});
		await page.goto('/connections');
		const row = page.locator('.connection-card').filter({ has: page.getByText('SSH test trust', { exact: true }) });
		const dialog = page.getByRole('dialog', { name: 'SSH Host Keys', exact: true });
		await row.getByRole('button', { name: 'Test', exact: true }).click();
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText(actual.fingerprint);
		if (changed) {
			await expect(dialog).toContainText(previous);
			await expect(dialog.locator('.ui-confirmation-panel__icon')).toHaveAttribute('data-tone', 'danger');
		}
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(row.getByRole('button', { name: 'Test', exact: true })).toBeEnabled();
		expect(attempts).toBe(1);
		expect(trustWrites).toBe(0);
		expect((await readPin())?.fingerprint ?? null).toBe(changed ? previous : null);
		await expect(row.locator('.connection-meta__item--success')).toHaveCount(0);

		await row.getByRole('button', { name: 'Test', exact: true }).click();
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Trust and reconnect', exact: true }).click();
		await expect(row.locator('.connection-meta__item--success')).toContainText('Connection test successful!');
		expect(attempts).toBe(3);
		expect(trustWrites).toBe(1);
		expect((await readPin())?.fingerprint).toBe(actual.fingerprint);
		await expect(page).toHaveURL(/\/connections$/);
		await expect(page.locator('.terminal-tab-shell')).toHaveCount(0);
	});
}

test('unsaved SSH test confirms trust and tests the draft without saving it', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	const before = readConnectionList(await (await context.request.get('/api/v1/targets/connections')).json());
	await page.goto('/connections');
	await page.getByRole('button', { name: 'Add New Connection', exact: true }).click();
	const form = page.locator('form.connection-form');
	await form.locator('#conn-name').fill('Unsaved trust test');
	await form.locator('#conn-host').fill(E2E_SSH.host);
	await form.locator('#conn-port').fill(String(E2E_SSH.port));
	await form.locator('#conn-username').fill(E2E_SSH.username);
	await form.locator('#conn-password').fill(E2E_SSH.password);
	await form.getByRole('button', { name: 'Test Connection', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'SSH Host Keys', exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(form.getByRole('button', { name: 'Test Connection', exact: true })).toBeEnabled();
	await expect(form.locator('footer [data-ui="badge"][data-tone="success"]')).toHaveCount(0);
	await form.getByRole('button', { name: 'Test Connection', exact: true }).click();
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Trust and reconnect', exact: true }).click();
	await expect(form.locator('footer [data-ui="badge"][data-tone="success"]')).toBeVisible();
	const after = readConnectionList(await (await context.request.get('/api/v1/targets/connections')).json());
	expect(after).toEqual(before);
	await form.getByRole('button', { name: 'Cancel', exact: true }).click();
});
