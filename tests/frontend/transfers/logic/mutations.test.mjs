// @vitest-environment jsdom
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { serverTransfersApi } from '../../../../packages/frontend/src/features/transfers/api/server-transfers-api.ts';
import { useServerTransfersStore } from '../../../../packages/frontend/src/features/transfers/store/serverTransfers.store.ts';

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
	useServerTransfersStore().reset();
	vi.restoreAllMocks();
});

const id = '00000000-0000-4000-8000-000000000001';

test('removal queued during cancellation sends its distinct intent once, after cancellation settles', async () => {
	const gate = Promise.withResolvers();
	const entered = Promise.withResolvers();
	const cancel = vi.spyOn(serverTransfersApi, 'cancel').mockImplementation(async () => {
		entered.resolve();
		await gate.promise;
	});
	const remove = vi.spyOn(serverTransfersApi, 'remove').mockResolvedValue(undefined);
	vi.spyOn(serverTransfersApi, 'list').mockResolvedValue([]);
	const store = useServerTransfersStore();
	const cancelling = store.cancel(id);
	const removing = store.remove(id);
	const duplicateRemove = store.remove(id);
	await entered.promise;
	expect(cancel).toHaveBeenCalledTimes(1);
	expect(remove).not.toHaveBeenCalled();
	gate.resolve();
	await Promise.all([cancelling, removing, duplicateRemove]);
	expect(remove).toHaveBeenCalledTimes(1);
});

test('a queued different mutation cannot dispatch after the authenticated store resets', async () => {
	const gate = Promise.withResolvers();
	const entered = Promise.withResolvers();
	vi.spyOn(serverTransfersApi, 'cancel').mockImplementation(async () => {
		entered.resolve();
		await gate.promise;
	});
	const remove = vi.spyOn(serverTransfersApi, 'remove').mockResolvedValue(undefined);
	vi.spyOn(serverTransfersApi, 'list').mockResolvedValue([]);
	const store = useServerTransfersStore();
	const cancelling = store.cancel(id);
	const removing = store.remove(id);
	await entered.promise;
	store.reset();
	gate.resolve();
	await Promise.all([cancelling, removing]);
	expect(remove).not.toHaveBeenCalled();
	expect(store.items).toEqual([]);
});
