import { expect as baseExpect, test as base } from '@playwright/test';
import { resetTestSshFilesystem } from './ssh';
import { E2E_URLS } from './test-env';

export type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';

export type E2EDatabaseMode = 'seed' | 'empty';

type E2EFixtures = {
	e2eDatabaseMode: E2EDatabaseMode;
	_e2eTestReset: void;
};

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

async function resetExternalFixtures(file: string): Promise<void> {
	// The previous application must close successfully before these shared
	// controls change. Never erase an unknown-effect or resource-cleanup fence.
	const origins =
		process.env.NEXUS_E2E_SUITE === 'backend' && !file.includes('/agent/')
			? []
			: [
					E2E_URLS.openAiProviderOrigin,
					E2E_URLS.pluginRepositoryOrigin,
					...(process.env.NEXUS_E2E_SUITE === 'backend'
						? []
						: [E2E_URLS.deploymentPageOrigin, E2E_URLS.browserControlOrigin]),
				];
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

export const test = base.extend<E2EFixtures>({
	e2eDatabaseMode: ['seed', { option: true }],
	_e2eTestReset: [
		async ({ e2eDatabaseMode }, use, testInfo) => {
			await resetE2EBaseline(e2eDatabaseMode);
			const file = testInfo.file.replaceAll('\\', '/');
			const protocolWithoutSsh =
				process.env.NEXUS_E2E_SUITE === 'backend' &&
				!file.includes('/ssh/') &&
				!file.includes('/websocket/') &&
				!['connections-tags', 'webhook-secret-contract', 'rdp-remoteapp', 'ssh-key-audit-failure'].some(
					(name) => file.endsWith('/' + name + '.spec.ts'),
				);
			if (!protocolWithoutSsh) await resetTestSshFilesystem();
			await resetExternalFixtures(file);

			await use();
		},
		{ auto: true },
	],
});

export const expect = baseExpect;
