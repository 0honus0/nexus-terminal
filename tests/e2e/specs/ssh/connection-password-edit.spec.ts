import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, configureSshE2eSettings, createTestSshConnection, trustTestSshHostKey } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { readConnectionView, readCredentialView } from '../../../../packages/shared/src/targets/connections/http-codec';

test('corrected password tests the draft and saves once with metadata; blank keeps and explicit clear removes', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await trustTestSshHostKey(context.request);
	const headers = { Origin: E2E_URLS.frontendOrigin };
	const name = 'Password correction';
	const id = await createTestSshConnection(context.request, name, {
		kind: 'password',
		password: `wrong-${crypto.randomUUID()}`,
	});
	const endpoint = `/api/v1/targets/connections/${id}`;

	const read = async () => {
		const response = await context.request.get(endpoint);
		expect(response.status()).toBe(200);
		return readConnectionView(await response.json());
	};

	const savedTest = () => context.request.post(`${endpoint}/test`, { headers });

	expect((await savedTest()).status()).toBe(422);
	const initial = await read();
	const writes: string[] = [];
	page.on('request', (request) => {
		const path = new URL(request.url()).pathname;
		if (request.method() === 'PUT' && path.startsWith(endpoint)) writes.push(path);
	});
	await page.goto('/connections');
	const row = page.locator('.connection-card').filter({ has: page.getByText(name, { exact: true }) });
	const form = page.locator('form.connection-form');
	const save = form.getByRole('button', { name: 'Confirm Edit', exact: true });
	await row.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(form.locator('#conn-password')).toHaveValue('');
	await expect(form.getByRole('button', { name: 'Save credentials only', exact: true })).toHaveCount(0);
	await form.locator('#conn-password').fill(E2E_SSH.password);
	await form.getByRole('button', { name: 'Test Connection', exact: true }).click();
	await expect(form.locator('footer [data-ui="badge"][data-tone="success"]')).toBeVisible();
	expect(await read()).toEqual(initial);
	expect(writes).toEqual([]);
	// Cancelling a successful draft test must leave the original wrong credential untouched.
	await form.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(form).toBeHidden();
	expect((await savedTest()).status()).toBe(422);
	await row.getByRole('button', { name: 'Edit', exact: true }).click();
	await form.locator('#conn-password').fill(E2E_SSH.password);
	await form.locator('#conn-notes').fill('Password and configuration saved together');
	await save.click();
	await expect(form).toBeHidden();
	expect(writes).toEqual([endpoint]);
	expect(await read()).toMatchObject({
		version: initial.version + 1,
		notes: 'Password and configuration saved together',
	});
	expect((await savedTest()).status()).toBe(200);

	await row.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(form.locator('#conn-password')).toHaveValue('');
	await form.locator('#conn-notes').fill('Keep saved password');
	await save.click();
	await expect(form).toBeHidden();
	expect((await savedTest()).status()).toBe(200);
	const beforeFailure = await read();
	const failed = await context.request.put(endpoint, {
		headers,
		data: {
			version: beforeFailure.version,
			changes: { name: 'Must roll back' },
			credential: { kind: 'ssh_key', sshKeyId: Number.MAX_SAFE_INTEGER },
		},
	});
	expect(failed.status()).toBe(404);
	expect(await read()).toEqual(beforeFailure);
	expect((await savedTest()).status()).toBe(200);
	const stale = await context.request.put(endpoint, {
		headers,
		data: {
			version: beforeFailure.version - 1,
			changes: { name: 'Stale edit' },
			credential: { kind: 'password', password: 'Must not overwrite' },
		},
	});
	expect(stale.status()).toBe(409);
	expect(await read()).toEqual(beforeFailure);
	expect((await savedTest()).status()).toBe(200);

	await row.getByRole('button', { name: 'Edit', exact: true }).click();
	await form.getByRole('checkbox', { name: 'Clear credentials', exact: true }).check();
	await expect(form.locator('#conn-password')).toBeDisabled();
	await save.click();
	await expect(form).toBeHidden();
	const credential = await context.request.get(`${endpoint}/credential`);
	expect(credential.status()).toBe(200);
	expect(readCredentialView(await credential.json()).credential.kind).toBe('none');
	expect((await read()).version).toBe(beforeFailure.version + 1);
});
