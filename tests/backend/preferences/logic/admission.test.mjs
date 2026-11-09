import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { CommandService } from '../../../../packages/backend/src/modules/preferences/commands/service/command-service.ts';
import { FavoriteService } from '../../../../packages/backend/src/modules/preferences/favorites/service/favorite-service.ts';
import { HistoryService } from '../../../../packages/backend/src/modules/preferences/history/service/history-service.ts';
import { PresentationService } from '../../../../packages/backend/src/modules/preferences/presentation/service/presentation-service.ts';
import { ConfigurationService } from '../../../../packages/backend/src/modules/preferences/configuration/service/configuration-service.ts';

const actor = { userId: 1, token: 'current-session' };
const query = { sortBy: 'name', kind: 'command', offset: 0, limit: 1 };

for (const [name, Service, read, result] of [
	['commands', CommandService, (service) => service.list(actor, query), []],
	['favorites', FavoriteService, (service) => service.list(actor, query), []],
	['history', HistoryService, (service) => service.list(actor, query), []],
	['presentation', PresentationService, (service) => service.get(actor), null],
]) {
	test(`${name}: concurrent admitted reads drain without a separate request-count refusal`, async () => {
		const gate = Promise.withResolvers();
		const started = Promise.withResolvers();
		const load = vi.fn(async () => {
			started.resolve();
			await gate.promise;
			return result;
		});
		const service = new Service({ list: load, get: load });
		const requests = Array.from({ length: 33 }, () => read(service));
		const results = Promise.allSettled(requests);
		await started.promise;
		const closing = service.close();
		assert.equal(service.close(), closing);
		let drained = false;
		void closing.then(() => (drained = true));
		await assert.rejects(read(service), { code: 'unavailable' });
		assert.equal(drained, false);
		gate.resolve();
		const settled = await results;
		await closing;
		assert.equal(load.mock.calls.length, requests.length);
		assert.ok(settled.every((result) => result.status === 'fulfilled'));
	});
}

test('configuration: admitted reads keep serial order and finish during shutdown without a queue-count refusal', async () => {
	const gate = Promise.withResolvers();
	const started = Promise.withResolvers();
	let record;
	let active = 0;
	let peak = 0;
	const load = vi.fn(async () => {
		active++;
		peak = Math.max(peak, active);
		started.resolve();
		await gate.promise;
		active--;
		return record;
	});
	const service = new ConfigurationService({
		find: async () => null,

		initialize: async (value) => value,

		validateNetwork() {},

		get: load,
	});
	record = await service.initialize();
	const requests = Array.from({ length: 33 }, () => service.get());
	const results = Promise.allSettled(requests);
	await started.promise;
	const closing = service.close();
	assert.equal(service.close(), closing);
	await assert.rejects(service.get(), { code: 'unavailable' });
	gate.resolve();
	const settled = await results;
	await closing;
	assert.equal(load.mock.calls.length, requests.length);
	assert.equal(peak, 1);
	assert.ok(settled.every((result) => result.status === 'fulfilled'));
});
