import { createServer } from 'node:http';
import { once } from 'node:events';
import { buildNativePluginPackage } from '../../support/native-plugin-package.mjs';
import { expectStatus } from '../remote/openssh-fixture.mjs';

/** Installs through the ordinary trust, repository, verification and installation flow. */
export async function createTestAgentApp(api, directory, name, options = {}) {
	const { metadata, bytes } = await buildNativePluginPackage(directory, name, options.signingKeyPath, options);
	let baseUrl;
	const server = createServer((request, response) => {
		if (request.url === '/catalog.json') {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					schemaVersion: 1,
					publishers: [
						{
							keyId: metadata.publisherKeyId,
							label: 'Native integration fixture',
							publicKeyPem: metadata.publicKeyPem,
						},
					],
					packages: [
						{
							appId: metadata.appId,
							version: metadata.version,
							sdkVersion: metadata.sdkVersion,
							nexus: metadata.nexus,
							displayName: metadata.displayName,
							description: 'Signed native integration fixture',
							packageUrl: baseUrl + '/plugin.tar',
							sha256: metadata.sha256,
							sizeBytes: metadata.sizeBytes,
							publisherKeyId: metadata.publisherKeyId,
						},
					],
				}),
			);
		} else if (request.url === '/plugin.tar') {
			response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length });
			response.end(bytes);
		} else response.writeHead(404).end();
	});
	try {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		baseUrl = 'http://127.0.0.1:' + server.address().port;
		const publishers = expectStatus(await api('GET', '/api/v1/agent/plugins/publishers'), 200);
		if (!publishers.items.some((publisher) => publisher.keyId === metadata.publisherKeyId)) {
			expectStatus(
				await api('POST', '/api/v1/agent/plugins/publishers', {
					label: 'Native integration fixture',
					publicKeyPem: metadata.publicKeyPem,
				}),
				200,
			);
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
		let stage;
		try {
			stage = expectStatus(
				await api('POST', '/api/v1/agent/plugins/remote/stage', {
					repositoryUrl,
					appId: metadata.appId,
					version: metadata.version,
				}),
				200,
			);
		} finally {
			expectStatus(
				await api('PUT', '/api/v1/agent/plugins/repositories', {
					expectedVersion: configured.version,
					repositories: settings.repositories.map((entry) => ({ url: entry.url })),
				}),
				200,
			);
		}
		const installation = expectStatus(
			await api('POST', '/api/v1/agent/plugins/install', {
				stageId: stage.id,
				expectedVersion: stage.version,
			}),
			200,
		);
		const appPath = '/api/v1/agent/apps/' + installation.appId;
		const app = expectStatus(await api('GET', appPath), 200);
		return expectStatus(await api('PATCH', appPath, { expectedVersion: app.version, enabled: true }), 200);
	} finally {
		server.closeAllConnections();
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
}
