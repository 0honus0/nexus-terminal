import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPinnedPluginPackage, pinnedExecutionFixture } from '../../support/pinned-plugin-package.mjs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { buildNativePluginPackage } from '../../support/native-plugin-package.mjs';
import { expectStatus } from '../remote/openssh-fixture.mjs';

/** Installs through the ordinary trust, repository, verification and installation flow. */
export async function createTestAgentApp(api, directory, name, options = {}) {
	let signingKeyPath = options.signingKeyPath;
	if (!signingKeyPath) {
		signingKeyPath = join(directory, 'native-publisher.pem');
		try {
			await readFile(signingKeyPath);
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
			const { privateKey } = generateKeyPairSync('ed25519');
			await writeFile(signingKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
		}
	}
	const existingPackages = expectStatus(await api('GET', '/api/v1/agent/plugins/packages'), 200);
	const neededIds = options.selectedRootIds ?? [
		'nexus.tools.remote',
		'nexus.tools.browser',
		'nexus.tools.integrations',
		'nexus.tools.agent',
	];
	const useModelApp =
		options.backend === undefined && options.contribution === undefined && options.deterministic !== true;
	const uiPackageId =
		options.uiPackageId === undefined ? (useModelApp ? 'nexus.ui.chat' : null) : options.uiPackageId;
	const dependencies = [];
	for (const packageId of [...new Set([...neededIds, ...(uiPackageId ? [uiPackageId] : [])])]) {
		const existing = existingPackages.installations.find(
			(entry) => entry.packageId === packageId && entry.status === 'installed',
		);
		if (!existing) dependencies.push(await buildPinnedPluginPackage(directory, packageId));
	}
	const execution = useModelApp ? await pinnedExecutionFixture() : {};
	const main = await buildNativePluginPackage(directory, name, signingKeyPath, {
		...execution,
		...options,
		dependencies: options.dependencies ?? [],
	});
	const { metadata } = main;
	const packages = [...dependencies, main];
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
			if (publishers.items.some((existing) => existing.keyId === publisher.keyId && existing.revokedAt === null))
				continue;
			const trusted = expectStatus(
				await api('POST', '/api/v1/agent/plugins/publishers', {
					label: publisher.label,
					publicKeyPem: publisher.publicKeyPem,
				}),
				200,
			);
			if (trusted.keyId !== publisher.keyId) throw new Error('Native fixture publisher identity mismatch');
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
		try {
			for (const { metadata } of packages) {
				const installed = expectStatus(await api('GET', '/api/v1/agent/plugins/packages'), 200);
				if (
					installed.installations.some(
						(entry) => entry.packageId === metadata.packageId && entry.status === 'installed',
					)
				)
					continue;
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
		} finally {
			expectStatus(
				await api('PUT', '/api/v1/agent/plugins/repositories', {
					expectedVersion: configured.version,
					repositories: settings.repositories.map((entry) => ({ url: entry.url })),
				}),
				200,
			);
		}
		const { binding } = expectStatus(
			await api('POST', '/api/v1/agent/plugins/apps/compose', {
				packageId: metadata.packageId,
				selectedRootIds: neededIds,
				uiPackageId,
			}),
			200,
		);
		const appPath = '/api/v1/agent/apps/' + binding.appId;
		const app = expectStatus(await api('GET', appPath), 200);
		return expectStatus(await api('PATCH', appPath, { expectedVersion: app.version, enabled: true }), 200);
	} finally {
		server.closeAllConnections();
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
}
