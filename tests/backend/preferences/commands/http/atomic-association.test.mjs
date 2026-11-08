import { randomUUID } from 'node:crypto';
import { expect, test, loginAsAdmin, HTTP_TEST_ORIGIN } from '../../../../support/http/protocol-fixture.mjs';
import {
	readCommandMutation,
	readCommandTagMutation,
	readCommandList,
	readCommandError,
	readCommandAssignResponse,
} from '../../../../../packages/shared/src/preferences/commands/http-codec.ts';
const headers = { Origin: HTTP_TEST_ORIGIN };
const targets = '/api/v1/targets';
const query = { sortBy: 'usageCount', limit: 50, offset: 0 };

async function commandFixture(request) {
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

async function currentCommand(request, id) {
	const response = await request.get('/api/v1/quick-commands?sortBy=usageCount&limit=50&offset=0');
	expect(response.ok()).toBe(true);
	const value = readCommandList(await response.json(), query).entries.find((item) => item.id === id);
	if (!value) throw new Error('Expected command missing');
	return value;
}

async function cleanupCommand(request, id, tag) {
	const failures = [];
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

test('quick command tag batches reject duplicates, invalid IDs and repeated commands atomically', async ({
	request,
}) => {
	await loginAsAdmin(request);
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
test('quick command batches roll back when a referenced command or tag is missing', async ({ request }) => {
	await loginAsAdmin(request);
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
