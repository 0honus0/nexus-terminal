import { createPinia, setActivePinia } from 'pinia';
import { vi, onTestFinished, expect } from 'vitest';
import { join } from 'node:path';
import { URL as NodeURL } from 'node:url';
import { openFrontendApplication } from '../../../support/http/frontend-application.mjs';
import { createAccessApi } from '../../../../packages/frontend/src/features/auth/api/access-api.ts';
import { mutationApi } from '../../../../packages/frontend/src/features/mutation-recovery/api/mutation-api.ts';
import { useMutationRecoveryStore } from '../../../../packages/frontend/src/features/mutation-recovery/store/mutation-recovery.store.ts';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';

export async function openMutations() {
	const app = await openFrontendApplication({
		prepareDatabaseModule: new NodeURL('../../../support/http/seed-mutations.mjs', import.meta.url).href,
	});
	vi.stubGlobal('fetch', app.fetch);
	onTestFinished(() => vi.unstubAllGlobals());
	expect((await fetch('/api/v1/remote/mutations')).status).toBe(401);
	const access = createAccessApi();
	const password = 'Mutation-fixture-2026!';
	await access.setup({ username: 'admin', password, confirmPassword: password });
	await access.login({ username: 'admin', password, rememberMe: false });
	const identity = await access.status();
	const pinia = createPinia();
	setActivePinia(pinia);
	const store = useMutationRecoveryStore(pinia);
	onTestFinished(() => store.reset());
	return { app, api: mutationApi, store, pinia, identity };
}

export function evidence(original, outcome = 'not_applied') {
	return {
		expectedRevision: original.revision,
		outcome,
		producerStopped: true,
		resourcesStopped: true,
		observedAt: Date.now(),
		note: 'Fixture evidence: no remote operation was executed.',
	};
}

/** This opens an independent real Adapter only after the original HTTP/Worker owner has fully stopped. */
export async function persisted(fixture, ids) {
	await fixture.app.close();
	const reader = new Worker(new NodeURL('../../../support/http/read-mutations-worker.mjs', import.meta.url), {
		workerData: { database: join(fixture.app.directory, 'application.db'), ids },
		execArgv: [],
	});
	const [[claims], [code]] = await Promise.all([once(reader, 'message'), once(reader, 'exit')]);
	if (code !== 0) throw new Error('Independent mutation reader exited with code ' + code);
	return claims;
}
