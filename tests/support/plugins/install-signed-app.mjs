import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expectStatus } from '../protocols/openssh-fixture.mjs';

/** Serve exact signed archive bytes and use the ordinary trust/install/compose flow. */
export async function installSignedAgentApp(api, packages, { packageId, selectedRootIds, uiPackageId }) {
	assert.ok(packages.some((entry) => entry.metadata.packageId === packageId));
	assert.equal(new Set(packages.map((entry) => entry.metadata.packageId)).size, packages.length);
	const packagePublishers = [
		...new Map(
			packages.map(({ metadata }) => [
				metadata.publisherKeyId,
				{
					keyId: metadata.publisherKeyId,
					label: 'Native integration fixture: ' + metadata.publisherKeyId,
					publicKeyPem: metadata.publicKeyPem,
				},
			]),
		).values(),
	];
	let baseUrl;
	const failures = [];
	const server = createServer((request, response) => {
		if (request.url === '/catalog.json') {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					schemaVersion: 2,
					publishers: packagePublishers,
					packages: packages.map(({ metadata }) => ({
						packageId: metadata.packageId,
						version: metadata.version,
						compatibility: metadata.compatibility,
						contributionKinds: metadata.contributionKinds,
						requiredOnEnable: metadata.requiredOnEnable,
						displayName: metadata.displayName,
						description: 'Signed native integration fixture',
						packageUrl: baseUrl + '/' + metadata.packageId + '.tar',
						sha256: metadata.sha256,
						sizeBytes: metadata.sizeBytes,
						publisherKeyId: metadata.publisherKeyId,
					})),
				}),
			);
		} else {
			const candidate = packages.find(({ metadata }) => request.url === '/' + metadata.packageId + '.tar');
			if (!candidate) {
				response.writeHead(404).end();
				return;
			}
			response.writeHead(200, {
				'Content-Type': 'application/octet-stream',
				'Content-Length': candidate.bytes.length,
			});
			response.end(candidate.bytes);
		}
	});
	try {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		baseUrl = 'http://127.0.0.1:' + server.address().port;
		const publishers = expectStatus(await api('GET', '/api/v1/agent/plugins/publishers'), 200);
		for (const publisher of packagePublishers) {
			if (
				publishers.items.some((existing) => existing.keyId === publisher.keyId && existing.revokedAt === null)
			) {
				continue;
			}
			const trusted = expectStatus(
				await api('POST', '/api/v1/agent/plugins/publishers', {
					label: publisher.label,
					publicKeyPem: publisher.publicKeyPem,
				}),
				200,
			);
			if (trusted.keyId !== publisher.keyId) {
				throw new Error('Native fixture publisher identity mismatch');
			}
		}
		const settings = expectStatus(await api('GET', '/api/v1/agent/plugins/repositories'), 200);
		const repositoryUrl = baseUrl + '/catalog.json';
		const configured = expectStatus(
			await api('PUT', '/api/v1/agent/plugins/repositories', {
				expectedVersion: settings.version,
				repositories: settings.repositories.map((entry) => ({ url: entry.url })).concat({ url: repositoryUrl }),
			}),
			200,
		);
		const installationFailures = [];
		try {
			for (const { metadata } of packages) {
				const installed = expectStatus(await api('GET', '/api/v1/agent/plugins/packages'), 200);
				if (
					installed.installations.some((entry) => {
						if (entry.packageId !== metadata.packageId || entry.status !== 'installed') {
							return false;
						}
						assert.equal(
							entry.version,
							metadata.version,
							'Installed package version differs from candidate',
						);
						assert.equal(
							entry.publisherKeyId,
							metadata.publisherKeyId,
							'Installed publisher differs from candidate',
						);
						assert.equal(entry.packageHash, metadata.sha256, 'Installed archive differs from candidate');
						return true;
					})
				) {
					continue;
				}
				const stage = expectStatus(
					await api('POST', '/api/v1/agent/plugins/remote/stage', {
						repositoryUrl,
						packageId: metadata.packageId,
						publisherKeyId: metadata.publisherKeyId,
						version: metadata.version,
					}),
					200,
				);
				expectStatus(
					await api('POST', '/api/v1/agent/plugins/packages/install', {
						stageId: stage.id,
						expectedVersion: stage.version,
					}),
					200,
				);
			}
		} catch (error) {
			installationFailures.push(error);
		} finally {
			try {
				expectStatus(
					await api('PUT', '/api/v1/agent/plugins/repositories', {
						expectedVersion: configured.version,
						repositories: settings.repositories.map((entry) => ({ url: entry.url })),
					}),
					200,
				);
			} catch (error) {
				installationFailures.push(error);
			}
		}
		if (installationFailures.length === 1) {
			throw installationFailures[0];
		}
		if (installationFailures.length > 1) {
			throw new AggregateError(installationFailures, 'Install and repository restore failed');
		}
		const { binding } = expectStatus(
			await api('POST', '/api/v1/agent/plugins/apps/compose', {
				packageId,
				selectedRootIds,
				uiPackageId,
			}),
			200,
		);
		const appPath = '/api/v1/agent/apps/' + binding.appId;
		const app = expectStatus(await api('GET', appPath), 200);
		return expectStatus(await api('PATCH', appPath, { expectedVersion: app.version, enabled: true }), 200);
	} catch (error) {
		failures.push(error);
	} finally {
		try {
			server.closeAllConnections();
			await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		} catch (error) {
			failures.push(error);
		}
		if (failures.length === 1) {
			throw failures[0];
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Signed package installation and server close failed');
		}
	}
}
