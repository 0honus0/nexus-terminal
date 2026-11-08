import { createServer } from 'node:http';
import { once } from 'node:events';
import { expectStatus } from './protocols/openssh-fixture.mjs';

/** Serve exact signed test bytes through the ordinary repository and staging path. */
export async function withSignedPluginCatalog(api, packages, work) {
	const publishers = [
		...new Map(
			packages.map(({ metadata }) => [
				metadata.publisherKeyId,
				{
					keyId: metadata.publisherKeyId,
					label: 'SDK4 lifecycle fixture',
					publicKeyPem: metadata.publicKeyPem,
				},
			]),
		).values(),
	];
	let address;
	const server = createServer((request, response) => {
		if (request.url === '/catalog.json') {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					schemaVersion: 2,
					publishers,
					packages: packages.map(({ metadata }) => ({
						packageId: metadata.packageId,
						version: metadata.version,
						compatibility: metadata.compatibility,
						contributionKinds: metadata.contributionKinds,
						displayName: metadata.displayName,
						description: 'Signed SDK4 fixture',
						packageUrl: address + '/' + metadata.packageId + '-' + metadata.version + '.tar',
						sha256: metadata.sha256,
						sizeBytes: metadata.sizeBytes,
						publisherKeyId: metadata.publisherKeyId,
					})),
				}),
			);
			return;
		}
		const artifact = packages.find(
			({ metadata }) => request.url === '/' + metadata.packageId + '-' + metadata.version + '.tar',
		);
		if (!artifact) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, {
			'Content-Type': 'application/octet-stream',
			'Content-Length': artifact.bytes.length,
		});
		response.end(artifact.bytes);
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	address = 'http://127.0.0.1:' + server.address().port;
	const base = '/api/v1/agent/plugins';
	let configured;
	let previous;
	try {
		const trusted = expectStatus(await api('GET', base + '/publishers'), 200);
		for (const publisher of publishers)
			if (!trusted.items.some((entry) => entry.keyId === publisher.keyId && entry.revokedAt === null)) {
				expectStatus(
					await api('POST', base + '/publishers', {
						label: publisher.label,
						publicKeyPem: publisher.publicKeyPem,
					}),
					200,
				);
			}
		previous = expectStatus(await api('GET', base + '/repositories'), 200);
		const repositoryUrl = address + '/catalog.json';
		configured = expectStatus(
			await api('PUT', base + '/repositories', {
				expectedVersion: previous.version,
				repositories: [...previous.repositories.map((entry) => ({ url: entry.url })), { url: repositoryUrl }],
			}),
			200,
		);
		return await work(
			async (artifact) =>
				expectStatus(
					await api('POST', base + '/remote/stage', {
						repositoryUrl,
						packageId: artifact.metadata.packageId,
						publisherKeyId: artifact.metadata.publisherKeyId,
						version: artifact.metadata.version,
					}),
					200,
				),
			{ repositoryUrl },
		);
	} finally {
		try {
			if (configured)
				expectStatus(
					await api('PUT', base + '/repositories', {
						expectedVersion: configured.version,
						repositories: previous.repositories.map((entry) => ({ url: entry.url })),
					}),
					200,
				);
		} finally {
			server.closeAllConnections();
			await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	}
}
