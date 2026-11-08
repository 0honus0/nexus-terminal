import { readFile } from 'node:fs/promises';
import { test, expect } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { dismissToasts } from '../../support/feedback';
import { readSshKeyList } from '../../../../packages/shared/src/targets/ssh-keys/http-codec';
import {
	readConnectionImportInput,
	readConnectionImportResponse,
	readConnectionList,
} from '../../../../packages/shared/src/targets/connections/http-codec';
import { TARGET_SSH_PRIVATE_KEY_MAX_BYTES } from '../../../../packages/shared/src/targets/ssh-keys/values';

const invalidInput = 'Invalid or oversized input. Check the name, port and credentials.';

test('native key file chooser rejects invalid UTF-8 and oversized files, then creates a key from complete file bytes', async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.goto('/connections');
	await page.getByRole('button', { name: 'SSH Key Management', exact: true }).filter({ visible: true }).click();
	const modal = page.getByRole('dialog');
	await modal.getByRole('button', { name: 'Add Key', exact: true }).click();
	await modal.locator('#key-name').fill('native file key');
	let writes = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/targets/ssh-keys') writes++;
	});
	for (const [name, buffer] of [
		['invalid-key', Buffer.from([255])],
		['oversized-key', Buffer.alloc(TARGET_SSH_PRIVATE_KEY_MAX_BYTES + 1)],
	] as const) {
		const choosing = page.waitForEvent('filechooser');
		await modal.getByRole('button', { name: 'Choose Key File', exact: true }).click();
		await (await choosing).setFiles({ name, mimeType: 'text/plain', buffer });
		await expect(page.getByRole('alert').filter({ hasText: invalidInput })).toBeVisible();
		await expect(modal.locator('#key-private')).toHaveValue('');
		await expect(modal.locator('#key-name')).toBeEnabled();
		expect(writes).toBe(0);
		await dismissToasts(page);
	}
	const choosing = page.waitForEvent('filechooser');
	await modal.getByRole('button', { name: 'Choose Key File', exact: true }).click();
	await (
		await choosing
	).setFiles({ name: 'valid-key', mimeType: 'text/plain', buffer: Buffer.from('formal-private-key') });
	await expect(modal.locator('#key-private')).toHaveValue('formal-private-key');
	await modal.locator('#key-passphrase').fill('formal-phrase');
	await modal.getByRole('button', { name: 'Add Key', exact: true }).click();
	await expect(modal.locator('#key-private')).toHaveCount(0);
	const listed = await context.request.get('/api/v1/targets/ssh-keys');
	expect(listed.status()).toBe(200);
	expect(readSshKeyList(await listed.json()).filter((key) => key.name === 'native file key')).toHaveLength(1);
	expect(writes).toBe(1);
	expect(errors).toEqual([]);
});

test('native connection JSON import retains partial receipts and configuration download omits credentials', async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.goto('/connections');
	const more = page.getByRole('button', { name: 'More actions', exact: true });
	await more.click();
	await page.getByRole('button', { name: 'Import connections', exact: true }).click();
	const modal = page.getByRole('dialog');
	let writes = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/targets/connections/import')
			writes++;
	});
	await modal
		.locator('input[type=file]')
		.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from([255]) });
	await expect(modal.getByText(invalidInput, { exact: true })).toBeVisible();
	expect(writes).toBe(0);

	const input = (name: string) => ({
		name,
		type: 'SSH',
		host: '127.0.0.1',
		port: 22,
		username: 'user',
		route: 'direct',
		proxyId: null,
		notes: null,
		tagIds: [],
		jumpIds: [],
	});

	const connection = input('native import good');
	await modal.locator('input[type=file]').setInputFiles({
		name: 'connections.json',
		mimeType: 'application/json',
		buffer: Buffer.from(
			JSON.stringify([
				{ connection, credential: { kind: 'password', password: 'private import password' } },
				{
					connection: input('native import bad'),
					credential: { kind: 'ssh_key', sshKeyId: Number.MAX_SAFE_INTEGER },
				},
			]),
		),
	});
	await expect(modal.getByText('Loaded connections.json', { exact: true })).toBeVisible();
	await modal.getByRole('button', { name: 'Paste JSON', exact: true }).click();
	await expect(modal.locator('textarea')).toHaveValue(/native import good/);
	const importedResults: ReturnType<typeof readConnectionImportResponse>[] = [];
	await page.route(
		'**/api/v1/targets/connections/import',
		async (route) => {
			const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
			try {
				expect(route.request().method()).toBe('POST');
				expect(response.status()).toBe(200);
				const bytes = await response.body();
				const result = readConnectionImportResponse(JSON.parse(bytes.toString('utf8')));
				await route.fulfill({ response, body: bytes });
				importedResults.push(result);
			} finally {
				await response.dispose();
			}
		},
		{ times: 1 },
	);
	await modal.getByRole('button', { name: 'Import connections', exact: true }).click();
	await expect.poll(() => importedResults.length).toBe(1);
	const receipts = importedResults[0].items;
	expect(receipts).toHaveLength(2);
	expect(receipts[0]).toMatchObject({ status: 'ok' });
	expect(receipts[1]).toMatchObject({ status: 'error', code: 'reference_not_found' });
	await expect(modal).toBeVisible();
	await expect(modal.getByText('The operation failed. Please try again later.', { exact: true })).toBeVisible();
	const listed = await context.request.get('/api/v1/targets/connections');
	expect(listed.status()).toBe(200);
	const saved = readConnectionList(await listed.json());
	const confirmed = saved.filter((item) => item.name === connection.name);
	expect(confirmed).toHaveLength(1);
	expect(receipts[0]).toMatchObject({ status: 'ok', id: confirmed[0].id });
	expect(saved.filter((item) => item.name === 'native import bad')).toEqual([]);
	await modal.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload();
	await expect(page.getByRole('listitem').filter({ hasText: connection.name })).toBeVisible();
	await page.getByRole('searchbox').fill(connection.name);
	await more.click();
	const downloading = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export configuration', exact: true }).click();
	const download = await downloading;
	expect(download.suggestedFilename()).toBe('connections.json');
	const path = await download.path();
	if (!path) throw Error('Actual configuration download path missing');
	const exported: unknown = JSON.parse(await readFile(path, 'utf8'));
	expect(Array.isArray(exported)).toBe(true);
	if (!Array.isArray(exported)) throw Error('Configuration download must contain an array');
	expect(exported).toHaveLength(1);
	expect(exported.map(readConnectionImportInput)).toEqual([{ connection }]);
	expect(Object.keys(exported[0])).toEqual(['connection']);
	expect(writes).toBe(1);
	expect(errors).toEqual([]);
});
