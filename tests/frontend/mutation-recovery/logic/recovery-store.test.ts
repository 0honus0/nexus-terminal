// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useMutationRecoveryStore } from '../../../../packages/frontend/src/features/mutation-recovery/store/mutation-recovery.store';
import { authenticatedSessionLifecycle } from '../../../../packages/frontend/src/shared/session/public';
import type { MutationClaimView } from '../../../../packages/shared/src/remote/mutations/model';

const server = setupServer();

const permission = (): AbortSignal => new AbortController().signal;

function claim(id = 'claim-1'): MutationClaimView {
	return {
		id,
		origin: 'files',
		state: 'blocked',
		revision: 2,
		createdAt: 1,
		blockedAt: 2,
		releasedAt: null,
		recoveryAllowed: true,
		targets: [{ targetId: 1, fingerprint: 'a'.repeat(64) }],
		evidence: [],
	};
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
	useMutationRecoveryStore().reset();
	authenticatedSessionLifecycle.dispose();
	server.resetHandlers();
});
afterAll(() => server.close());

test('a superseded detail failure cannot overwrite the current selection state', async () => {
	const entered = Promise.withResolvers<void>();
	const oldResponse = Promise.withResolvers<Response>();
	server.use(
		http.get('http://localhost/api/v1/remote/mutations/:id', async ({ params }) => {
			if (params.id === 'old') {
				entered.resolve();
				return oldResponse.promise;
			}
			return HttpResponse.json(claim('current'));
		}),
	);
	const store = useMutationRecoveryStore();
	const old = store.select('old', permission()).catch((error: unknown) => error);
	await entered.promise;
	const current = store.select('current', permission());
	oldResponse.resolve(HttpResponse.json({ code: 'storage_unavailable' }, { status: 503 }));
	await old;
	await current;
	expect(store.selected?.id).toBe('current');
	expect(store.error).toBeNull();
	expect(store.busy).toBe(false);
});

test('an unknown write is fenced until explicit reads and is never replayed', async () => {
	let writes = 0;
	server.use(
		http.get('http://localhost/api/v1/remote/mutations', () =>
			HttpResponse.json({ items: [claim()], nextCursor: null }),
		),
		http.get('http://localhost/api/v1/remote/mutations/claim-1', () => HttpResponse.json(claim())),
		http.post('http://localhost/api/v1/remote/mutations/claim-1/evidence', () => {
			writes++;
			return HttpResponse.error();
		}),
	);
	const store = useMutationRecoveryStore();
	await store.load(permission());
	await store.select('claim-1', permission());
	const evidence = {
		expectedRevision: 2,
		outcome: 'not_applied' as const,
		producerStopped: true,
		resourcesStopped: true,
		observedAt: 3,
		note: 'Verified remote owner stopped',
	};
	await expect(store.evidence(claim(), evidence, permission())).rejects.toMatchObject({ outcome: 'unknown' });
	expect(store.blocked).toBe(true);
	await expect(store.evidence(claim(), evidence, permission())).rejects.toMatchObject({
		code: 'refresh_required',
		outcome: 'not_dispatched',
	});
	await store.load(permission(), true);
	expect(store.blocked).toBe(false);
	expect(store.error).toBeNull();
	expect(writes).toBe(1);
});

test('identity disposal cancels pending data and releases the original busy state', async () => {
	const entered = Promise.withResolvers<void>();
	const result = Promise.withResolvers<Response>();
	server.use(
		http.get('http://localhost/api/v1/remote/mutations/:id', () => {
			entered.resolve();
			return result.promise;
		}),
	);
	const store = useMutationRecoveryStore();
	const pending = store.select('claim-1', permission()).catch((error: unknown) => error);
	await entered.promise;
	authenticatedSessionLifecycle.dispose();
	result.resolve(HttpResponse.json(claim()));
	await pending;
	expect(store.selected).toBeNull();
	expect(store.error).toBeNull();
	expect(store.busy).toBe(false);
});
