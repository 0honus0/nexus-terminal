import { test, expect, loginAsAdmin } from '../../../../support/http/protocol-fixture.mjs';
import {
	readCommandMutation,
	readCommandTagMutation,
	readCommandAssignResponse,
	readCommandList,
} from '../../../../../packages/shared/src/preferences/commands/http-codec.ts';

test('an atomic association accepts more than 1000 distinct real commands and returns its complete count', async ({
	request,
}) => {
	await loginAsAdmin(request);
	const commands = [];
	// Keep every durable HTTP write. A bounded fixture batch overlaps client
	// round-trips without creating 1001 simultaneous request/socket buffers.
	const count = 1001;
	const batchSize = 32;
	for (let offset = 0; offset < count; offset += batchSize) {
		commands.push(
			...(await Promise.all(
				Array.from({ length: Math.min(batchSize, count - offset) }, async (_, localIndex) => {
					const index = offset + localIndex;
					const response = await request.post('/api/v1/quick-commands', {
						data: { name: 'Large batch ' + index, command: 'printf ' + index, variables: {}, tagIds: [] },
					});
					expect(response.status()).toBe(201);
					const command = readCommandMutation(await response.json()).command;
					return { id: command.id, expectedVersion: command.version };
				}),
			)),
		);
	}
	const created = await request.post('/api/v1/quick-command-tags', { data: { name: 'Large association' } });
	expect(created.status()).toBe(201);
	const tag = readCommandTagMutation(await created.json()).tag;
	const assigned = await request.post('/api/v1/quick-commands/bulk-assign-tag', {
		data: { commands, tagId: tag.id },
	});
	expect(assigned.status()).toBe(200);
	expect(readCommandAssignResponse(await assigned.json()).count).toBe(commands.length);
	const pages = [];
	for (let offset = 0; offset < commands.length; offset += 50) {
		const query = { sortBy: 'name', offset, limit: 50 };
		const response = await request.get(
			'/api/v1/quick-commands?' +
				new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])),
		);
		expect(response.status()).toBe(200);
		pages.push(...readCommandList(await response.json(), query).entries);
	}
	expect(pages.map((c) => c.id).sort((a, b) => a - b)).toEqual(commands.map((c) => c.id).sort((a, b) => a - b));
	expect(pages.every((c) => c.version === 2 && c.tagIds.length === 1 && c.tagIds[0] === tag.id)).toBe(true);
}, 30_000);
