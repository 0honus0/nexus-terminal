import { expect, test, type APIRequestContext } from '../../support/fixtures';
import type { Response } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import { configureSshE2eSettings, E2E_SSH, ensureTestSshConnection, trustTestSshHostKey } from '../../support/ssh';
import { slowStep, step } from '../../support/steps';
import { E2E_URLS } from '../../support/test-env';

import {
	readConnectionList,
	readConnectionView,
	readConnectionImportResponse,
} from '../../../../packages/shared/src/targets/connections/http-codec';
import { readTagList } from '../../../../packages/shared/src/targets/tags/http-codec';
import {
	readConnectionTestResponse,
	readConnectionTestFailure,
} from '../../../../packages/shared/src/targets/connections/test-codec';

const headers = { Origin: E2E_URLS.frontendOrigin };

function importedId(value: unknown): number {
	const results = readConnectionImportResponse(value).items;
	expect(results).toHaveLength(1);
	const first = results[0];
	if (!first || first.status !== 'ok') throw new Error('Connection import failed');
	return first.id;
}

const FORM_NAME = 'E2E UI Created SSH';
const FORM_CLONE_NAME = `${FORM_NAME} Copy`;
const SCRIPT_NAME_ONE = 'E2E Script SSH One';
const SCRIPT_NAME_TWO = 'E2E Script SSH Two';
const SCRIPT_TAG = 'E2E Script Imported Tag';

async function cleanupConnections(request: APIRequestContext): Promise<void> {
	const response = await request.get('/api/v1/targets/connections');
	expect(response.ok()).toBeTruthy();
	const connections = readConnectionList(await response.json());
	for (const connection of connections.filter((item) =>
		[FORM_NAME, FORM_CLONE_NAME, SCRIPT_NAME_ONE, SCRIPT_NAME_TWO].includes(item.name || ''),
	)) {
		expect((await request.delete(`/api/v1/targets/connections/${connection.id}`, { headers })).ok()).toBeTruthy();
	}

	const tagsResponse = await request.get('/api/v1/targets/tags');
	expect(tagsResponse.ok()).toBeTruthy();
	const tags = readTagList(await tagsResponse.json());
	for (const tag of tags.filter((item) => item.name === SCRIPT_TAG)) {
		expect((await request.delete(`/api/v1/targets/tags/${tag.id}`, { headers })).ok()).toBeTruthy();
	}
}

test.beforeEach(async ({ context }) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await trustTestSshHostKey(context.request);
	await cleanupConnections(context.request);
});

test.afterEach(async ({ context }) => {
	await cleanupConnections(context.request);
});

test('connections page remains usable when connection tags fail to load', async ({ page, context }) => {
	await ensureTestSshConnection(context.request);
	await page.route('**/api/v1/targets/tags', (route) => route.abort('failed'));

	await page.goto('/connections');
	await expect(
		page.getByRole('listitem').filter({ has: page.getByText(E2E_SSH.name, { exact: true }) }),
	).toBeVisible();
	await expect(
		page.getByText('Failed to load connection tags. Connections are still available.', { exact: true }),
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add New Connection', exact: true })).toBeEnabled();
});

test('direct connection form remains usable when the proxy catalog fails to load', async ({ page }) => {
	await page.route('**/api/v1/targets/proxies', (route) => route.abort('failed'));
	await page.goto('/connections');
	await page.getByRole('button', { name: 'Add New Connection', exact: true }).click();

	const form = page.locator('form.connection-form');
	await expect(form).toBeVisible();
	await expect(page.getByText('Options could not be loaded. Refresh and review.', { exact: true })).toBeVisible();
	await form.locator('#conn-name').fill(FORM_NAME);
	await form.locator('#conn-host').fill(E2E_SSH.host);
	await form.locator('#conn-port').fill(String(E2E_SSH.port));
	await form.locator('#conn-username').fill(E2E_SSH.username);
	await form.locator('#conn-password').fill(E2E_SSH.password);

	const createPromise = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/v1/targets/connections/import') && response.request().method() === 'POST',
	);
	await form.getByRole('button', { name: 'Confirm Add', exact: true }).click();
	const created = await createPromise;
	expect(created.status()).toBe(200);
	importedId(await created.json());
	await expect(form).toBeHidden({ timeout: 15_000 });
});

test('regular connection form tests and creates a persisted working SSH connection', async ({ page, context }) => {
	await page.goto('/connections');
	await page.getByRole('button', { name: 'Add New Connection', exact: true }).click();
	const form = page.locator('form.connection-form');
	await expect(form).toBeVisible();

	await form.locator('#conn-name').fill(FORM_NAME);
	await form.locator('#conn-host').fill(E2E_SSH.host);
	await form.locator('#conn-port').fill(String(E2E_SSH.port));
	await form.locator('#conn-username').fill(E2E_SSH.username);
	await form.locator('#conn-password').fill(E2E_SSH.password);
	await form.locator('#conn-notes').fill('created through the browser form');

	await slowStep('failed SSH tests render an inline red result without replacing the form', async () => {
		await form.locator('#conn-port').fill('1');
		const responsePromise = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/v1/targets/connections/test-unsaved') &&
				response.request().method() === 'POST',
		);
		await form.getByRole('button', { name: 'Test Connection', exact: true }).click();
		const response = await responsePromise;
		expect(response.status()).toBe(422);
		expect(readConnectionTestFailure(await response.json())).toEqual({ code: 'connection_failed' });
		const result = form.locator('footer span.text-error');
		await expect(result).toBeVisible();
		await expect(result).toHaveClass(/text-error/);
		await expect(result).toContainText('SSH connection failed.');
		await expect(form).toBeVisible();
		await form.locator('#conn-port').fill(String(E2E_SSH.port));
	});

	await slowStep('test the unsaved connection against the real SSH fixture', async () => {
		const responsePromise = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/v1/targets/connections/test-unsaved') &&
				response.request().method() === 'POST',
		);
		await form.getByRole('button', { name: 'Test Connection', exact: true }).click();
		const response = await responsePromise;
		expect(response.ok()).toBeTruthy();
		expect(readConnectionTestResponse(await response.json()).status).toBe('ok');
		const result = form.locator('footer span.text-success');
		await expect(result).toBeVisible();
		await expect(result).toHaveClass(/text-success/);
	});

	let connectionId = 0;
	await step('submit persists the connection and refreshes the visible list', async () => {
		const createPromise = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/v1/targets/connections/import') && response.request().method() === 'POST',
		);
		await form.getByRole('button', { name: 'Confirm Add', exact: true }).click();
		const create = await createPromise;
		expect(create.status()).toBe(200);
		connectionId = importedId(await create.json());
		await expect(form).toBeHidden({ timeout: 15_000 });
		const row = page.getByRole('listitem').filter({ has: page.getByText(FORM_NAME, { exact: true }) });
		await expect(row).toContainText(FORM_NAME);
		await expect(row).toContainText('created through the browser form');
	});

	await slowStep('the saved connection still authenticates with its stored credential', async () => {
		const testResponse = await context.request.post(`/api/v1/targets/connections/${connectionId}/test`, {
			headers,
		});
		expect(testResponse.ok()).toBeTruthy();
		expect(readConnectionTestResponse(await testResponse.json()).status).toBe('ok');
	});

	await step('Clone creates a distinct saved row that preserves the working SSH credential', async () => {
		const row = page.getByRole('listitem').filter({ has: page.getByText(FORM_NAME, { exact: true }) });
		const clonePromise = page.waitForResponse(
			(response) =>
				response.url().endsWith(`/api/v1/targets/connections/${connectionId}/clone`) &&
				response.request().method() === 'POST',
		);
		await row.getByRole('button', { name: 'Clone', exact: true }).click();
		const clone = await clonePromise;
		expect(clone.status()).toBe(201);
		const cloneId = readConnectionView(await clone.json()).id;
		expect(cloneId).not.toBe(connectionId);
		await expect(
			page.getByRole('listitem').filter({ has: page.getByText(FORM_CLONE_NAME, { exact: true }) }),
		).toBeVisible();
		const cloneTest = await context.request.post(`/api/v1/targets/connections/${cloneId}/test`, { headers });
		expect(cloneTest.ok()).toBeTruthy();
		expect(readConnectionTestResponse(await cloneTest.json()).status).toBe('ok');
	});

	await step('the row connect action routes the saved connection into Workspace', async () => {
		const row = page.getByRole('listitem').filter({ has: page.getByText(FORM_NAME, { exact: true }) });
		await Promise.all([
			page.waitForURL(
				(url) =>
					url.pathname.includes('/workspace') &&
					url.searchParams.get('connectionId') === String(connectionId),
			),
			row.getByRole('button', { name: 'Connect', exact: true }).click(),
		]);
	});
});

test('script mode creates multiple connections, resolves tags, and preserves notes', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await page.goto('/connections');
	await page.getByRole('button', { name: 'Add New Connection', exact: true }).click();
	const form = page.locator('form.connection-form');
	await expect(form).toBeVisible();

	const scriptToggle = form.getByRole('switch', { name: 'Script Mode', exact: true });
	await scriptToggle.click();
	await expect(scriptToggle).toHaveAttribute('aria-checked', 'true');
	const scriptInput = form.locator('#conn-script-input');
	await expect(scriptInput).toBeVisible();
	await scriptInput.fill(
		[
			`${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port} -name "${SCRIPT_NAME_ONE}" -p "${E2E_SSH.password}" -tags "${SCRIPT_TAG}" -note "script first note"`,
			`${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port} -name "${SCRIPT_NAME_TWO}" -p "${E2E_SSH.password}" -tags "${SCRIPT_TAG}" -note "script second note"`,
		].join('\n'),
	);

	await step('one script submission imports both connections', async () => {
		const responsePromise = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/v1/targets/connections/import') && response.request().method() === 'POST',
		);
		await form.getByRole('button', { name: 'Confirm Add', exact: true }).click();
		const response = await responsePromise;
		expect(response.status()).toBe(200);
		const results = readConnectionImportResponse(await response.json()).items;
		expect(results).toHaveLength(2);
		expect(results.every((item) => item.status === 'ok')).toBe(true);
		await expect(form).toBeHidden({ timeout: 15_000 });
	});

	const connectionsResponse = await context.request.get('/api/v1/targets/connections');
	expect(connectionsResponse.ok()).toBeTruthy();
	const connections = readConnectionList(await connectionsResponse.json()).filter(
		(item) => item.name === SCRIPT_NAME_ONE || item.name === SCRIPT_NAME_TWO,
	);
	expect(connections).toHaveLength(2);
	expect(connections.find((item) => item.name === SCRIPT_NAME_ONE)?.notes).toBe('script first note');
	expect(connections.find((item) => item.name === SCRIPT_NAME_TWO)?.notes).toBe('script second note');

	const tagsResponse = await context.request.get('/api/v1/targets/tags');
	expect(tagsResponse.ok()).toBeTruthy();
	const tags = (await tagsResponse.json()) as Array<{ id: number; name: string }>;
	const createdTag = tags.find((tag) => tag.name === SCRIPT_TAG);
	if (!createdTag) throw new Error('Script tag missing');
	for (const connection of connections) expect(connection.tagIds).toContain(createdTag.id);

	for (const connection of connections) {
		const testResponse = await context.request.post(`/api/v1/targets/connections/${connection.id}/test`, {
			headers,
		});
		expect(testResponse.ok()).toBeTruthy();
		expect(readConnectionTestResponse(await testResponse.json()).status).toBe('ok');
	}

	await step('Test All operates on the currently filtered saved SSH rows', async () => {
		const testedIds = new Set<number>();
		const expectedIds = new Set(connections.map((connection) => connection.id));

		const recordTest = (response: Response) => {
			if (response.request().method() !== 'POST') return;
			const match = response.url().match(/\/api\/v1\/targets\/connections\/(\d+)\/test$/);
			if (!match || !response.ok()) return;
			testedIds.add(Number(match[1]));
		};

		page.on('response', recordTest);
		await page.getByPlaceholder('Search connections...', { exact: true }).fill('E2E Script SSH');
		await page.getByRole('button', { name: 'Test All', exact: true }).click();
		await expect.poll(() => testedIds.size, { timeout: 15_000 }).toBe(2);
		page.off('response', recordTest);
		expect(testedIds).toEqual(expectedIds);
	});
});
