import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { createTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { getTestAppearance, updateTestAppearance } from '../../support/appearance';
import { getTestTheme, listTestThemes, removeTestTheme } from '../../support/themes';
import {
	readCommandMutation,
	readCommandTagMutation,
	readCommandList,
	readCommandError,
	readCommandAssignResponse,
} from '../../../../packages/shared/src/preferences/commands/http-codec';
import { readProxyView, readProxyMutation } from '../../../../packages/shared/src/targets/proxies/http-codec';
import { readSshKeyView, readSshKeyMutation } from '../../../../packages/shared/src/targets/ssh-keys/http-codec';
import { readTagView, readTagConnectionsResponse } from '../../../../packages/shared/src/targets/tags/http-codec';
import { readConnectionView } from '../../../../packages/shared/src/targets/connections/http-codec';
import { readTerminalThemeView } from '../../../../packages/shared/src/preferences/themes/http-codec';
import { readTargetError } from '../../../../packages/shared/src/targets/http';
import { readAuditResponse } from '../../../../packages/shared/src/operations/http-codec';
import type { QuickCommand } from '../../../../packages/shared/src/preferences/commands/model';

const headers = { Origin: E2E_URLS.frontendOrigin };
const targets = '/api/v1/targets';
const query = { sortBy: 'usageCount', limit: 50, offset: 0 } as const;

async function commandFixture(request: APIRequestContext) {
	const created = await request.post('/api/v1/quick-commands', {
		headers,
		data: { name: 'E2E bulk ' + randomUUID(), command: 'echo e2e', variables: {}, tagIds: [] },
	});
	expect(created.status()).toBe(201);
	const command = readCommandMutation(await created.json()).command;
	const tagged = await request.post('/api/v1/quick-command-tags', {
		headers,
		data: { name: 'E2E tag ' + randomUUID() },
	});
	expect(tagged.status()).toBe(201);
	const tag = readCommandTagMutation(await tagged.json()).tag;
	return { command, tag };
}

async function currentCommand(request: APIRequestContext, id: number): Promise<QuickCommand> {
	const response = await request.get('/api/v1/quick-commands?sortBy=usageCount&limit=50&offset=0');
	expect(response.ok()).toBe(true);
	const value = readCommandList(await response.json(), query).entries.find((item) => item.id === id);
	if (!value) throw new Error('Expected command missing');
	return value;
}

async function cleanupCommand(
	request: APIRequestContext,
	id: number,
	tag: { id: number; version: number },
): Promise<void> {
	const failures: unknown[] = [];
	try {
		const current = await currentCommand(request, id);
		const response = await request.delete('/api/v1/quick-commands/' + id, {
			headers,
			data: { expectedVersion: current.version },
		});
		expect(response.ok()).toBe(true);
	} catch (cause) {
		failures.push(cause);
	}
	try {
		const response = await request.delete('/api/v1/quick-command-tags/' + tag.id, {
			headers,
			data: { expectedVersion: tag.version },
		});
		expect(response.ok()).toBe(true);
	} catch (cause) {
		failures.push(cause);
	}
	if (failures.length) throw new AggregateError(failures, 'Command fixture cleanup failed');
}

test('quick command tag batches reject duplicates, invalid IDs and raw oversized input atomically', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const { command, tag } = await commandFixture(request);
	const entry = { id: command.id, expectedVersion: command.version };
	try {
		for (const data of [
			{ commands: [entry, entry], tagId: tag.id },
			...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((tagId) => ({ commands: [entry], tagId })),
			...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((id) => ({
				commands: [{ id, expectedVersion: command.version }],
				tagId: tag.id,
			})),
			{ commands: Array(1001).fill(entry), tagId: tag.id },
		]) {
			const rejected = await request.post('/api/v1/quick-commands/bulk-assign-tag', { headers, data });
			expect(rejected.status()).toBe(400);
			expect(readCommandError(await rejected.json()).code).toBe('invalid_input');
			expect(await currentCommand(request, command.id)).toEqual(command);
		}
		const assigned = await request.post('/api/v1/quick-commands/bulk-assign-tag', {
			headers,
			data: { commands: [entry], tagId: tag.id },
		});
		expect(assigned.ok()).toBe(true);
		expect(readCommandAssignResponse(await assigned.json()).count).toBe(1);
		expect(await currentCommand(request, command.id)).toMatchObject({
			tagIds: [tag.id],
			version: command.version + 1,
		});
	} finally {
		await cleanupCommand(request, command.id, tag);
	}
});

test('proxy invalid credentials cannot partially rename metadata and secret values never enter the view', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const name = 'E2E proxy invariant ' + randomUUID();
	const created = await request.post(targets + '/proxies', {
		headers,
		data: { name, type: 'SOCKS5', host: '127.0.0.1', port: 1080, username: 'e2e', password: 'e2e-proxy-secret' },
	});
	expect(created.status()).toBe(201);
	const proxy = readProxyView(await created.json());
	try {
		for (const changes of [
			{ name: name + ' rejected', password: '' },
			{ name: name + ' rejected', password: 123 },
			{ name: name + ' rejected', privateKey: 'unsupported' },
		]) {
			const rejected = await request.put(targets + '/proxies/' + proxy.id, {
				headers,
				data: { version: proxy.version, changes },
			});
			expect(rejected.status()).toBe(400);
			expect(readTargetError(await rejected.json()).code).toBe('invalid_input');
			const response = await request.get(targets + '/proxies/' + proxy.id);
			expect(response.ok()).toBe(true);
			expect(readProxyView(await response.json())).toEqual(proxy);
		}
		const renamed = await request.put(targets + '/proxies/' + proxy.id, {
			headers,
			data: { version: proxy.version, changes: { name: name + ' preserved' } },
		});
		expect(renamed.ok()).toBe(true);
		const mutation = readProxyMutation(await renamed.json());
		if (mutation.status !== 'updated') throw new Error('Proxy rename rejected');
		expect(mutation.value.version).toBe(proxy.version + 1);
		const cleared = await request.put(targets + '/proxies/' + proxy.id, {
			headers,
			data: { version: mutation.value.version, changes: { username: null, password: null } },
		});
		expect(cleared.ok()).toBe(true);
		expect(readProxyMutation(await cleared.json())).toMatchObject({ status: 'updated', value: { username: null } });
		expect(JSON.stringify(mutation)).not.toContain('e2e-proxy-secret');
	} finally {
		expect((await request.delete(targets + '/proxies/' + proxy.id, { headers })).ok()).toBe(true);
	}
});

test('quick command batches roll back when a referenced command or tag is missing', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const { command, tag } = await commandFixture(request);
	const actual = { id: command.id, expectedVersion: command.version };
	const missing = { id: Number.MAX_SAFE_INTEGER, expectedVersion: 1 };
	try {
		for (const commands of [
			[actual, missing],
			[missing, actual],
		]) {
			const response = await request.post('/api/v1/quick-commands/bulk-assign-tag', {
				headers,
				data: { commands, tagId: tag.id },
			});
			expect(response.status()).toBe(404);
			expect(readCommandError(await response.json()).code).toBe('not_found');
			expect(await currentCommand(request, command.id)).toEqual(command);
		}
		const missingTag = await request.post('/api/v1/quick-commands/bulk-assign-tag', {
			headers,
			data: { commands: [actual], tagId: Number.MAX_SAFE_INTEGER },
		});
		expect(missingTag.status()).toBe(404);
		expect(readCommandError(await missingTag.json()).code).toBe('not_found');
		expect(await currentCommand(request, command.id)).toEqual(command);
		const success = await request.post('/api/v1/quick-commands/bulk-assign-tag', {
			headers,
			data: { commands: [actual], tagId: tag.id },
		});
		expect(success.ok()).toBe(true);
		expect(readCommandAssignResponse(await success.json()).count).toBe(1);
		expect((await currentCommand(request, command.id)).tagIds).toEqual([tag.id]);
	} finally {
		await cleanupCommand(request, command.id, tag);
	}
});

test('SSH key mutations publish safe audit events without private key or passphrase content', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
		.privateKey.export({ type: 'pkcs1', format: 'pem' })
		.toString();
	const passphrase = 'e2e-secret-' + randomUUID();
	const path = targets + '/ssh-keys';
	const created = await request.post(path, {
		headers,
		data: { name: 'E2E audit ' + randomUUID(), privateKey, passphrase },
	});
	expect(created.status()).toBe(201);
	const key = readSshKeyView(await created.json());
	let deleted = false;
	try {
		const update = await request.put(path + '/' + key.id, {
			headers,
			data: { version: key.version, changes: { name: 'E2E audited rename', passphrase: null } },
		});
		expect(update.ok()).toBe(true);
		expect(readSshKeyMutation(await update.json()).status).toBe('updated');
		const removed = await request.delete(path + '/' + key.id, { headers });
		expect(removed.ok()).toBe(true);
		deleted = true;
		await expect
			.poll(async () => {
				const response = await request.get('/api/v1/settings/audit-logs?limit=100&offset=0');
				expect(response.ok()).toBe(true);
				const body: unknown = await response.json();
				const text = JSON.stringify(body);
				for (const secret of [passphrase, 'PRIVATE KEY', privateKey.split('\n')[1], 'updatedFields'])
					expect(text).not.toContain(secret);
				const logs = readAuditResponse(body).items;
				return ['SSH_KEY_CREATED', 'SSH_KEY_UPDATED', 'SSH_KEY_DELETED'].filter((event) =>
					logs.some(
						(log) =>
							log.event === event &&
							log.userId === 1 &&
							log.route === (event === 'SSH_KEY_CREATED' ? path : path + '/:id') &&
							(event === 'SSH_KEY_CREATED' || log.subjectId === String(key.id)),
					),
				).length;
			})
			.toBe(3);
	} finally {
		if (!deleted) expect((await request.delete(path + '/' + key.id, { headers })).ok()).toBe(true);
	}
});

test('connection tag replacement deduplicates and rejects invalid batches atomically', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const createdTag = await request.post(targets + '/tags', {
		headers,
		data: { name: 'E2E bounded tag ' + randomUUID() },
	});
	expect(createdTag.status()).toBe(201);
	const tag = readTagView(await createdTag.json());
	const id = await createTestSshConnection(request, 'E2E tag connection ' + randomUUID());

	const replace = (connectionIds: number[]) =>
		request.put(targets + '/tags/' + tag.id + '/connections', { headers, data: { connectionIds } });

	const readTags = async () => {
		const response = await request.get(targets + '/connections/' + id);
		expect(response.ok()).toBe(true);
		return readConnectionView(await response.json()).tagIds;
	};

	try {
		const assigned = await replace([id, id]);
		expect(assigned.ok()).toBe(true);
		readTagConnectionsResponse(await assigned.json());
		expect(await readTags()).toEqual([tag.id]);
		for (const ids of [[0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], Array(1001).fill(id)]) {
			const response = await replace(ids);
			expect(response.status()).toBe(400);
			expect(readTargetError(await response.json()).code).toBe('invalid_input');
			expect(await readTags()).toEqual([tag.id]);
		}
		expect((await replace([id, Number.MAX_SAFE_INTEGER])).status()).toBe(404);
		expect(await readTags()).toEqual([tag.id]);
		expect(
			(
				await request.put(targets + '/tags/9007199254740991/connections', {
					headers,
					data: { connectionIds: [] },
				})
			).status(),
		).toBe(404);
		const cleared = await replace([]);
		expect(cleared.ok()).toBe(true);
		readTagConnectionsResponse(await cleared.json());
		expect(await readTags()).toEqual([]);
	} finally {
		const results = await Promise.allSettled([
			request.delete(targets + '/connections/' + id, { headers }),
			request.delete(targets + '/tags/' + tag.id, { headers }),
		]);
		for (const result of results) {
			if (result.status === 'rejected') throw result.reason;
			expect(result.value.ok()).toBe(true);
		}
	}
});

test('deleting the selected terminal theme clears only its persisted appearance reference', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const original = await getTestAppearance(request);
	const name = 'E2E active delete ' + randomUUID();
	const created = await request.post('/api/v1/terminal-themes', {
		headers,
		data: { name, themeData: { background: '#101010', foreground: '#eeeeee' } },
	});
	expect(created.status()).toBe(201);
	const theme = readTerminalThemeView(await created.json());
	try {
		await updateTestAppearance(request, (input) => {
			input.activeTerminalThemeId = theme.id;
		});
		expect((await getTestAppearance(request)).activeTerminalThemeId).toBe(theme.id);
		await removeTestTheme(request, await getTestTheme(request, theme.id));
		expect((await request.get('/api/v1/terminal-themes/' + theme.id)).status()).toBe(404);
		expect((await getTestAppearance(request)).activeTerminalThemeId).toBeNull();
	} finally {
		const failures: unknown[] = [];
		try {
			await updateTestAppearance(request, (input) => {
				input.activeTerminalThemeId = original.activeTerminalThemeId;
			});
		} catch (cause) {
			failures.push(cause);
		}
		try {
			for (const item of (await listTestThemes(request)).filter((item) => item.name === name))
				await removeTestTheme(request, item);
		} catch (cause) {
			failures.push(cause);
		}
		if (failures.length) throw new AggregateError(failures, 'Active theme cleanup failed');
	}
});
