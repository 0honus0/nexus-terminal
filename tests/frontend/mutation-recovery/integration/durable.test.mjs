import { test, expect } from 'vitest';
import { openMutations, persisted } from '../support/fixture.mjs';
import { MutationRequestFailure } from '../../../../packages/frontend/src/features/mutation-recovery/model/mutation-types.ts';

test('recovery reads actual durable pages and keeps recording evidence separate from releasing a claim', async () => {
	const checks = [];
	const fixture = await openMutations();
	const { store, api: mutationApi } = fixture;
	const permission = new AbortController().signal;

	function ensure(value, message) {
		if (!value) {
			throw Error(message);
		}
	}

	async function refuses(work, code, outcome) {
		try {
			await work();
		} catch (cause) {
			ensure(
				cause instanceof MutationRequestFailure && cause.code === code && cause.outcome === outcome,
				'Unexpected failure ' + cause.code + '/' + cause.outcome,
			);
			return;
		}
		throw Error('Expected ' + code);
	}

	await store.load(permission);
	ensure(store.items.length === 20 && store.nextCursor === 'fixture-20', 'First real page/cursor');
	await store.load(permission, false, true);
	ensure(store.items.length === 22 && store.nextCursor === null, 'Second real page');
	checks.push('real two-page list uses server cursor, independently mapped claims and unique IDs');
	await store.select('fixture-01', permission);
	const original = store.selected;
	ensure(original.recoveryAllowed && original.revision === 2, 'Restart permits human recovery');
	const input = {
		expectedRevision: original.revision,
		outcome: 'partially_applied',
		producerStopped: true,
		resourcesStopped: true,
		observedAt: Date.now(),
		note: 'Fixture evidence: no remote operation was executed.',
	};
	await refuses(
		() => mutationApi.evidence(original, { ...input, producerStopped: false }),
		'invalid_input',
		'not_dispatched',
	);
	const aborted = new AbortController();
	aborted.abort();
	await refuses(() => store.evidence(original, input, aborted.signal), 'cancelled', 'not_dispatched');
	await store.evidence(original, input, permission);
	ensure(
		store.selected.revision === 3 && store.selected.evidence.length === 1 && store.selected.state === 'blocked',
		'Evidence does not release',
	);
	await store.release(store.selected, store.selected.evidence[0].id, permission);
	ensure(
		store.selected.revision === 4 && store.selected.state === 'released' && !store.selected.recoveryAllowed,
		'Independent release',
	);
	checks.push(
		'real evidence and separate release persist original revision/CAS; incomplete confirmation and revoked intent never dispatch',
	);
	await store.select('fixture-02', permission);
	const stale = store.selected;
	const nextInput = { ...input, expectedRevision: stale.revision, observedAt: Date.now() };
	await mutationApi.evidence(stale, nextInput, permission);
	await refuses(() => store.evidence(stale, nextInput, permission), 'version_conflict', 'confirmed');
	ensure(
		store.blocked && store.selected.revision === stale.revision,
		'Conflict retains original application snapshot',
	);
	await refuses(() => store.evidence(stale, nextInput, permission), 'refresh_required', 'not_dispatched');
	await store.load(permission, true);
	ensure(!store.blocked && store.selected.revision === 3, 'Explicit recovery reads detail');
	checks.push(
		'concurrent real CAS conflict blocks further writes until explicit list/detail read recovery, without version substitution',
	);
	expect(checks).toHaveLength(3);
	const [released] = await persisted(fixture, ['fixture-01']);
	expect(released.state).toBe('released');
	expect(released.evidenceCount).toBe(1);
});
