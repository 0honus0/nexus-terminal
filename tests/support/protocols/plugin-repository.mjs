import { createHash, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPinnedPluginPackage } from '../pinned-plugin-package.mjs';
import { buildNativePluginPackage } from '../native-plugin-package.mjs';
import { loadCandidatePackages } from '../plugins/candidate-packages.mjs';

const current = fileURLToPath(new URL('../../e2e/fixtures/agent/', import.meta.url));
const builder = fileURLToPath(new URL('../plugins/build-plugin-package.mjs', import.meta.url));
const host = process.env.NEXUS_E2E_PLUGIN_REPOSITORY_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.NEXUS_E2E_PLUGIN_REPOSITORY_PORT ?? '29092');
const publicBaseUrl = (
	process.env.NEXUS_E2E_PLUGIN_REPOSITORY_PUBLIC_BASE_URL?.trim() || `http://${host}:${port}`
).replace(/\/$/, '');
const hangOpenAiRequests = process.env.NEXUS_E2E_PLUGIN_REPOSITORY_HANG_OPENAI === '1';
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
	throw new Error('NEXUS_E2E_PLUGIN_REPOSITORY_PORT_INVALID');
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-e2e-plugin-repo-'));
const keyPath = path.join(temp, 'publisher.pem');
const configuredSigningKey = process.env.NEXUS_E2E_PLUGIN_SIGNING_KEY_PEM?.trim();
if (configuredSigningKey) fs.writeFileSync(keyPath, `${configuredSigningKey}\n`);
else {
	const { privateKey } = generateKeyPairSync('ed25519');
	fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
}

const pinnedPackages = process.env.NEXUS_TEST_PLUGIN_SET
	? (await loadCandidatePackages(process.env.NEXUS_TEST_PLUGIN_SET)).packages
	: await Promise.all(
			[
				'nexus.services.mcp',
				'nexus.services.acp',
				'nexus.tools.remote',
				'nexus.tools.browser',
				'nexus.tools.integrations',
				'nexus.tools.agent',
				'nexus.ui.chat',
				'nexus.agent',
			].map(async (id) => ({
				...(await buildPinnedPluginPackage(temp, id)),
				packageName: id + '.tar',
				description: 'Verbatim upstream package build pinned for offline E2E.',
			})),
		);

const buildPackage = (appId, version, sourceAppId = appId) => {
	const packageName = `${appId}-${version}.tar`;
	const packagePath = path.join(temp, packageName);
	const source = path.join(temp, sourceAppId);
	fs.cpSync(path.join(current, `plugin-source/${sourceAppId}`), source, { recursive: true });
	const manifestPath = path.join(source, 'manifest.json');
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	if (manifest.backendEntry) {
		fs.copyFileSync(
			path.resolve(current, '../../../../packages/backend/dist-plugin-sdk/backend-v4.mjs'),
			path.join(source, 'backend/sdk.mjs'),
		);
	}

	const metadata = JSON.parse(
		execFileSync(process.execPath, [builder, source, packagePath, keyPath], {
			cwd: current,
			encoding: 'utf8',
		}),
	);
	return { metadata, packageName, bytes: fs.readFileSync(packagePath) };
};

const packages = [
	...pinnedPackages,
	{
		...buildPackage('nexus.fullstack', '1.0.0'),
		description: 'Signed E2E first-party frontend/backend/runner target fixture.',
	},
	{
		...buildPackage('nexus.custom-surface', '1.0.0'),
		description: 'E2E-only focused Custom App Surface SDK fixture.',
		localizations: [
			{
				locale: 'en-US',
				displayName: 'Custom Surface',
				description: 'Localized marketplace acceptance fixture.',
			},
			{ locale: 'zh-CN', displayName: '自定义界面', description: '插件市场本地化验收说明。' },
			{ locale: 'ja-JP', displayName: 'カスタム画面', description: 'プラグイン市場の翻訳検証。' },
		],
	},
	{ ...buildPackage('nexus.intent-peer', '1.0.0'), description: 'E2E-only AppIntent receiver fixture.' },
	{
		...buildPackage('nexus.upgrade', '1.0.0', 'nexus.upgrade-v1'),
		description: 'E2E-only Plugin upgrade v1 fixture.',
	},
	{
		...buildPackage('nexus.upgrade', '2.0.0', 'nexus.upgrade-v2'),
		description: 'E2E-only Plugin upgrade v2 fixture.',
	},
];
const customPublisher = packages.find(({ metadata }) => metadata.packageId === 'nexus.fullstack').metadata;
const packagePublishers = [
	...new Map(
		packages.map(({ metadata }) => [
			metadata.publisherKeyId,
			{
				keyId: metadata.publisherKeyId,
				label:
					metadata.publisherKeyId === customPublisher.publisherKeyId
						? 'Nexus E2E Fixture Publisher'
						: 'Pinned upstream publisher',
				publicKeyPem: metadata.publicKeyPem,
			},
		]),
	).values(),
];

const unsafePackageName = 'nexus.unsafe-1.0.0.tar';
const unsafePackagePath = path.join(temp, unsafePackageName);
const unsafeRoot = path.join(temp, 'unsafe-package');
fs.mkdirSync(unsafeRoot, { recursive: true });
fs.symlinkSync('/etc/passwd', path.join(unsafeRoot, 'escape'));
execFileSync('tar', ['--format=ustar', '-cf', unsafePackagePath, '-C', unsafeRoot, '.']);
const unsafePackageBytes = fs.readFileSync(unsafePackagePath);
const unsafePackageHash = createHash('sha256').update(unsafePackageBytes).digest('hex');

const catalog = {
	schemaVersion: 2,
	publishers: packagePublishers,
	packages: [
		...packages.map(({ metadata, packageName, description, localizations }) => ({
			packageId: metadata.packageId,
			version: metadata.version,
			compatibility: metadata.compatibility,
			contributionKinds: metadata.contributionKinds,
			displayName: metadata.displayName,
			description,
			localizations,
			packageUrl: `${publicBaseUrl}/packages/${packageName}`,
			sha256: metadata.sha256,
			sizeBytes: metadata.sizeBytes,
			publisherKeyId: metadata.publisherKeyId,
		})),
		{
			packageId: 'nexus.unsafe',
			version: '1.0.0',
			compatibility: {
				host: { minVersion: '1.0.0', maxVersion: '1.99.99' },
				backendSdk: null,
				frontendSdk: null,
			},
			contributionKinds: ['app'],
			displayName: 'Unsafe Archive Fixture',
			description: 'E2E-only package containing a symbolic link and no trusted payload.',
			packageUrl: `${publicBaseUrl}/packages/${unsafePackageName}`,
			sha256: unsafePackageHash,
			sizeBytes: unsafePackageBytes.byteLength,
			publisherKeyId: customPublisher.publisherKeyId,
		},
		{
			packageId: 'nexus.agent',
			version: '1.0.4',
			compatibility: { host: { minVersion: '1.0.4', maxVersion: '1.0.99' }, backendSdk: null, frontendSdk: null },
			contributionKinds: ['app'],
			displayName: 'Nexus Agent',
			description: 'E2E-only compatibility fixture that requires a newer Nexus 1.0.x host.',
			packageUrl: `${publicBaseUrl}/packages/nexus.agent-1.0.4-incompatible.tar`,
			sha256: '0'.repeat(64),
			sizeBytes: 1,
			publisherKeyId: pinnedPackages.find(({ metadata }) => metadata.packageId === 'nexus.agent').metadata
				.publisherKeyId,
		},
	],
};
const officialCatalog = {
	schemaVersion: 2,
	publishers: catalog.publishers,
	packages: catalog.packages.filter((candidate) =>
		[
			'nexus.agent',
			'nexus.fullstack',
			'nexus.services.mcp',
			'nexus.services.acp',
			'nexus.tools.remote',
			'nexus.tools.browser',
			'nexus.tools.integrations',
			'nexus.tools.agent',
			'nexus.ui.chat',
		].includes(candidate.packageId),
	),
};
const officialCatalogBytes = Buffer.from(`${JSON.stringify(officialCatalog, null, 2)}\n`, 'utf8');
let officialCatalogEnabled = true;
const hangingProviderResponses = new Set();
const packageByUrl = new Map([
	...packages.map((candidate) => [`/packages/${candidate.packageName}`, candidate.bytes]),
	[`/packages/${unsafePackageName}`, unsafePackageBytes],
]);

const dynamicPackages = [];
const server = http.createServer(async (request, response) => {
	if (request.method === 'POST' && request.url === '/native-package') {
		try {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const { name, settingsKind, upgradePackageId } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			if (typeof name !== 'string' || !name.trim()) {
				response.writeHead(400).end();
				return;
			}
			if (settingsKind !== undefined && !['mcp-read', 'acp', 'none'].includes(settingsKind)) {
				response.writeHead(400).end();
				return;
			}
			if (
				upgradePackageId !== undefined &&
				(settingsKind !== 'none' ||
					!dynamicPackages.some((entry) => entry.packageId === upgradePackageId && entry.version === '1.0.0'))
			) {
				response.writeHead(400).end();
				return;
			}
			const extension =
				settingsKind === undefined
					? {
							sourcePackage: path.join(current, 'plugin-source/nexus.agent'),
							dependencies: [],
						}
					: {
							...(upgradePackageId === undefined
								? {}
								: { packageId: upgradePackageId, version: '2.0.0' }),
							capabilities:
								settingsKind === 'mcp-read'
									? ['integration.mcp.read']
									: settingsKind === 'acp'
										? ['integration.acp.invoke']
										: [],
						};

			const { metadata, bytes } = await buildNativePluginPackage(temp, name, keyPath, extension);
			const packageUrl = '/packages/' + metadata.packageId + '-' + metadata.version + '.tar';
			packageByUrl.set(packageUrl, bytes);
			dynamicPackages.push({
				packageId: metadata.packageId,
				version: metadata.version,
				compatibility: metadata.compatibility,
				contributionKinds: metadata.contributionKinds,
				displayName: metadata.displayName,
				description: 'Signed isolated native Agent fixture',
				packageUrl: publicBaseUrl + packageUrl,
				sha256: metadata.sha256,
				sizeBytes: metadata.sizeBytes,
				publisherKeyId: metadata.publisherKeyId,
			});
			response.writeHead(201, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ packageId: metadata.packageId }));
		} catch (error) {
			console.error('Native package fixture failed', error);
			response.writeHead(500).end();
		}
		return;
	}
	if (request.method === 'POST' && request.url === '/reset') {
		if (hangingProviderResponses.size) {
			response.writeHead(409).end();
			return;
		}
		for (const entry of dynamicPackages) packageByUrl.delete(new URL(entry.packageUrl).pathname);
		dynamicPackages.length = 0;
		officialCatalogEnabled = true;
		response.writeHead(204).end();
		return;
	}
	if (hangOpenAiRequests && request.method === 'POST' && request.url === '/v1/chat/completions') {
		request.resume();
		request.on('end', () => {
			hangingProviderResponses.add(response);
			response.on('close', () => hangingProviderResponses.delete(response));
		});
		return;
	}
	if (request.method === 'POST' && request.url === '/control/official-catalog/disable') {
		officialCatalogEnabled = false;
		response.writeHead(204).end();
		return;
	}
	if (request.method === 'POST' && request.url === '/control/official-catalog/enable') {
		officialCatalogEnabled = true;
		response.writeHead(204).end();
		return;
	}
	if (request.method === 'GET' && request.url === '/health') {
		response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
		response.end(JSON.stringify({ ok: true }));
		return;
	}
	if (request.method === 'GET' && request.url === '/catalog.json') {
		const catalogBytes = Buffer.from(
			JSON.stringify({ ...catalog, packages: catalog.packages.concat(dynamicPackages) }),
		);
		response.writeHead(200, {
			'Content-Type': 'application/json',
			'Content-Length': String(catalogBytes.byteLength),
			'Cache-Control': 'no-store',
		});
		response.end(catalogBytes);
		return;
	}
	if (request.method === 'GET' && request.url === '/official-catalog.json') {
		if (!officialCatalogEnabled) {
			response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
			response.end(JSON.stringify({ error: 'official catalog disabled for E2E' }));
			return;
		}
		response.writeHead(200, {
			'Content-Type': 'application/json',
			'Content-Length': String(officialCatalogBytes.byteLength),
			'Cache-Control': 'no-store',
		});
		response.end(officialCatalogBytes);
		return;
	}
	const packageBytes = request.method === 'GET' ? packageByUrl.get(request.url ?? '') : undefined;
	if (packageBytes) {
		response.writeHead(200, {
			'Content-Type': 'application/octet-stream',
			'Content-Length': String(packageBytes.byteLength),
			'Cache-Control': 'no-store',
		});
		response.end(packageBytes);
		return;
	}
	response.writeHead(404).end();
});

server.listen(port, host, () => {
	console.log(`[E2E Agent Plugin Repository] listening on http://${host}:${port}`);
});

const shutdown = () => {
	for (const response of hangingProviderResponses) response.destroy();
	server.close(() => {
		fs.rmSync(temp, { recursive: true, force: true });
		process.exit(0);
	});
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
