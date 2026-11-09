import { createHash, randomUUID } from 'node:crypto';
import { expect, onTestFinished, test } from 'vitest';
import { agentPluginCapabilityReplyBytes } from '../../../../../packages/shared/src/agent/plugins/runtime-codec.ts';
import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from '../../../../../packages/shared/src/agent/plugins/values.ts';
import { MemoryService } from '../../../../../packages/backend/src/modules/agent/memory/service/memory-service.ts';
import { PluginService } from '../../../../../packages/backend/src/modules/agent/plugins/service/plugin-service.ts';

const digest = (value) => createHash('sha256').update(value).digest('hex');

const escaped = '汉字🙂"\\\n\t'.repeat(60);

async function verifyPages(read, expected, operation, hashField, toValue = (page) => page) {
	const actual = [];
	let offset = 0;
	let snapshot;
	let pages = 0;
	do {
		const page = await read(offset);
		snapshot ??= page[hashField];
		expect(page[hashField]).toBe(snapshot);
		expect(agentPluginCapabilityReplyBytes({ operation, value: toValue(page) })).toBeLessThanOrEqual(
			AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
		);
		expect(page.items).toEqual(expected.slice(offset, offset + page.items.length));
		if (page.nextOffset !== null) {
			expect(page.items.length).toBeGreaterThan(0);
			expect(page.nextOffset).toBe(offset + page.items.length);
			// The actual wire encoder is the oracle: the next complete item must
			// exceed the frame, including the numeric cursor and JSON string escaping.
			const enlarged = {
				...page,
				items: [...page.items, expected[page.nextOffset]],
				nextOffset: page.nextOffset + 1 < expected.length ? page.nextOffset + 1 : null,
			};
			expect(agentPluginCapabilityReplyBytes({ operation, value: toValue(enlarged) })).toBeGreaterThan(
				AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
			);
		}
		actual.push(...page.items);
		offset = page.nextOffset;
		pages++;
	} while (offset !== null);
	expect(pages).toBeGreaterThan(1);
	expect(actual).toEqual(expected);
	expect((await read(expected.length)).items).toEqual([]);
}

test('memory candidate pages preserve every escaped item, exact cursor and maximal encoded prefix', async () => {
	const candidates = Array.from({ length: 1400 }, () => ({
		id: randomUUID(),
		version: 1,
		content: escaped,
		confidence: 1,
	}));
	// Only storage is replaced; pagination and the complete reply encoder are real.
	const service = new MemoryService({ recall: async () => candidates }, undefined);
	const actor = { kind: 'session', userId: 1, appId: randomUUID(), token: 'test' };
	await verifyPages(
		(offset) => service.candidates(actor, { offset, limit: 1 }),
		candidates,
		'memory.retrieve',
		'candidatesSha256',
		(page) => ({ action: 'candidates', ...page }),
	);
});

test('a memory candidate fitting the complete frame exactly is accepted and one extra byte is refused', async () => {
	const candidate = { id: randomUUID(), version: 1, content: 'x', confidence: 1 };
	const service = new MemoryService({ recall: async () => [candidate] }, undefined);
	const actor = { kind: 'session', userId: 1, appId: randomUUID(), token: 'test' };

	const read = () => service.candidates(actor, { offset: 0, limit: 1 });

	const initial = await read();
	candidate.content += 'x'.repeat(
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES -
			agentPluginCapabilityReplyBytes({
				operation: 'memory.retrieve',
				value: { action: 'candidates', ...initial },
			}),
	);
	const exact = await read();
	expect(exact.items).toEqual([candidate]);
	expect(exact.nextOffset).toBeNull();
	expect(
		agentPluginCapabilityReplyBytes({ operation: 'memory.retrieve', value: { action: 'candidates', ...exact } }),
	).toBe(AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
	candidate.content += 'x';
	await expect(read()).rejects.toMatchObject({ code: 'limit_exceeded' });
});

test('Skill catalog pages preserve signed metadata, escaped descriptions and full continuation', async () => {
	const skills = Array.from({ length: 1400 }, (_, index) => {
		const name = 'skill-' + index;
		const content = '---\nname: ' + name + '\ndescription: ' + JSON.stringify(escaped) + '\n---\nDo the task.';
		return { name, path: 'skills/' + name + '/SKILL.md', bytes: Buffer.from(content), sha256: digest(content) };
	});
	const reference = { packageId: 'test.skills', version: '1.0.0' };
	const source = {
		installation: { revision: 1 },
		files: skills,
		manifest: { contributions: { skills: skills.map(({ path }) => ({ path })) } },
	};
	const model = {
		runtimeBinding: async () => ({ app: reference, dependencies: [], selectedRootIds: [] }),

		packageSource: async () => source,

		runtimeInstallation: async () => source.installation,
	};
	const service = new PluginService(
		model,
		undefined,
		undefined,
		undefined,
		undefined,
		{ subscribe: () => () => {} },
		undefined,
		undefined,
		'1.1.0',
		undefined,
	);
	onTestFinished(() => service.close());
	const scope = { userId: 1, appId: randomUUID() };
	const signal = new AbortController().signal;
	await verifyPages(
		async (offset) =>
			(await service.performSkill(scope, { action: 'catalog', offset }, signal, async () => {})).value,
		skills.map(({ name, sha256 }) => ({ name, description: escaped, version: '1.0.0', sha256 })),
		'skills.catalog',
		'catalogSha256',
	);
});
