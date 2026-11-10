import { expect as baseExpect, test as base } from '@playwright/test';
import { resetTestSshFilesystem } from './ssh';
import { E2E_URLS } from '../../support/protocols/test-environment';
import path from 'node:path';
import { ControlledServices, type E2EServiceName } from './controlled-services';

export type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';

export { devices } from '@playwright/test';

export type E2EDatabaseMode = 'seed' | 'empty' | 'mutation-recovery';

type E2EFixtures = {
	e2eDatabaseMode: E2EDatabaseMode;
	e2eServices: readonly E2EServiceName[];
	_e2eTestReset: void;
};

type E2EWorkerFixtures = { _e2eServiceOwner: ControlledServices };

export const resetE2EBaseline = async (mode: E2EDatabaseMode) => {
	const token = process.env.NEXUS_E2E_CONTROL_TOKEN;
	if (!token) throw new Error('NEXUS_E2E_CONTROL_TOKEN is required');
	// A reset with a lost response is unknown; never retry replacement of the baseline.
	const response = await fetch(E2E_URLS.backendControlOrigin + '/reset', {
		method: 'POST',
		headers: { 'X-Nexus-E2E-Control': token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ mode }),
		signal: AbortSignal.timeout(60_000),
	});
	baseExpect(response.ok, 'Backend-next isolated baseline reset failed: HTTP ' + response.status).toBeTruthy();
	await baseExpect(response.json()).resolves.toEqual({ reset: true, mode });
};

async function retainE2EBaseline(): Promise<void> {
	const response = await fetch(E2E_URLS.backendControlOrigin + '/retain', {
		method: 'POST',
		headers: { 'X-Nexus-E2E-Control': process.env.NEXUS_E2E_CONTROL_TOKEN ?? '' },
		signal: AbortSignal.timeout(10_000),
	});
	baseExpect(response.status, 'Failed test database must be retained').toBe(200);
	await baseExpect(response.json()).resolves.toEqual({ retained: true });
}

export const test = base.extend<E2EFixtures, E2EWorkerFixtures>({
	e2eDatabaseMode: ['seed', { option: true }],
	e2eServices: [[], { option: true }],

	_e2eServiceOwner: [
		async ({}, use, workerInfo) => {
			const root = process.env.NEXUS_TEST_ARTIFACT_DIR ?? process.env.NEXUS_E2E_DATA_ROOT;
			if (!root) throw new Error('Test service artifact root is required');
			const owner = new ControlledServices(path.join(root, 'services', String(workerInfo.workerIndex)));
			try {
				await use(owner);
			} finally {
				const failures: unknown[] = [];
				// The application must drain before its remote peers are stopped.
				try {
					await resetE2EBaseline('empty');
				} catch (error) {
					failures.push(error);
				}
				try {
					await owner.close();
				} catch (error) {
					failures.push(error);
				}
				if (failures.length) throw new AggregateError(failures, 'E2E worker resources did not drain');
			}
		},
		{ scope: 'worker', timeout: 120_000 },
	],
	_e2eTestReset: [
		async ({ e2eDatabaseMode, e2eServices, _e2eServiceOwner }, use, testInfo) => {
			await resetE2EBaseline(e2eDatabaseMode);
			let failure: { cause: unknown } | null = null;
			try {
				await _e2eServiceOwner.ensure(e2eServices);
				if (e2eServices.includes('ssh')) await resetTestSshFilesystem();
				await use();
			} catch (cause) {
				failure = { cause };
			}
			if (failure || testInfo.status !== testInfo.expectedStatus) {
				try {
					await retainE2EBaseline();
				} catch (cause) {
					if (failure)
						throw new AggregateError([failure.cause, cause], 'E2E test and evidence retention failed');
					throw cause;
				}
			}
			if (failure) throw failure.cause;
		},
		{ auto: true },
	],
});

export const expect = baseExpect;
