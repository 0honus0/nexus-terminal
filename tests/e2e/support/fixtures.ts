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
	expectExecutionUnknown: () => void;
	_e2eTestReset: void;
};

type E2EWorkerFixtures = { _e2eServiceOwner: ControlledServices };

export const resetE2EBaseline = async (mode: E2EDatabaseMode, expectedShutdown?: 'execution_unknown') => {
	const token = process.env.NEXUS_E2E_CONTROL_TOKEN;
	if (!token) throw new Error('NEXUS_E2E_CONTROL_TOKEN is required');
	// A reset with a lost response is unknown; never retry replacement of the baseline.
	const response = await fetch(E2E_URLS.backendControlOrigin + '/reset', {
		method: 'POST',
		headers: { 'X-Nexus-E2E-Control': token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ mode, expectedShutdown }),
		signal: AbortSignal.timeout(60_000),
	});
	baseExpect(response.ok, 'Backend-next isolated baseline reset failed: HTTP ' + response.status).toBeTruthy();
	await baseExpect(response.json()).resolves.toEqual({ reset: true, mode });
};

async function resetExternalFixtures(services: readonly E2EServiceName[]): Promise<void> {
	// The previous application must close successfully before these shared
	// controls change. Never erase an unknown-effect or resource-cleanup fence.
	const origins = services.flatMap((name) => {
		switch (name) {
			case 'provider':
				return [E2E_URLS.openAiProviderOrigin];
			case 'plugins':
				return [E2E_URLS.pluginRepositoryOrigin];
			case 'deployment':
				return [E2E_URLS.deploymentPageOrigin];
			case 'browser':
				return [E2E_URLS.browserControlOrigin];
			default:
				return [];
		}
	});
	const results = await Promise.allSettled(
		origins.map(async (origin) => {
			const response = await fetch(origin + '/reset', {
				method: 'POST',
				signal: AbortSignal.timeout(10_000),
			});
			await response.arrayBuffer();
			baseExpect(response.status, 'External fixture reset failed: ' + origin).toBe(204);
		}),
	);
	const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
	if (failures.length) {
		throw new AggregateError(failures, 'External E2E baseline reset failed');
	}
}

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

	expectExecutionUnknown: async ({}, use) => {
		let expected = false;
		await use(() => {
			expected = true;
		});
		// Only a test that has asserted a deliberate unknown effect can request this.
		// The controller verifies the exact shutdown cause and retains its database;
		// cleanup failures and a missing expected fence still fail the test.
		if (expected) await resetE2EBaseline('empty', 'execution_unknown');
	},

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
		async ({ e2eDatabaseMode, e2eServices, _e2eServiceOwner, expectExecutionUnknown }, use, testInfo) => {
			// This dependency holds expected-shutdown verification until evidence retention finishes.
			void expectExecutionUnknown;
			await resetE2EBaseline(e2eDatabaseMode);
			let failure: { cause: unknown } | null = null;
			try {
				await _e2eServiceOwner.ensure(e2eServices);
				if (e2eServices.includes('ssh')) await resetTestSshFilesystem();
				await resetExternalFixtures(e2eServices);
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
