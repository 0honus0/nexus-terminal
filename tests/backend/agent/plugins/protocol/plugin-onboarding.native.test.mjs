import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { openPlugins } from '../support/plugin-management-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';
import { OFFICIAL_PLUGIN_SOURCE } from '../../../../../packages/backend/dist/modules/agent/plugins/service/plugin-source.js';
import { PluginService } from '../../../../../packages/backend/dist/modules/agent/plugins/service/plugin-service.js';
import { AgentFailure } from '../../../../../packages/backend/dist/modules/agent/agent-failure.js';
import {
	readAgentPluginEnablePlan,
	readAgentPluginEnableResponse,
} from '../../../../../packages/shared/dist/agent/plugins/onboarding-codec.js';

const base = '/api/v1/agent/plugins';
const onboarding = '/api/v1/agent/onboarding';

function reference(stage) {
	return {
		packageId: stage.manifest.id,
		version: stage.manifest.version,
		packageHash: stage.packageHash,
		publisherKeyId: stage.publisherKeyId,
	};
}

function command(plan) {
	return {
		packages: plan.packages.map((item) =>
			item.kind === 'installed'
				? {
						kind: 'installed',
						expectedRevision: item.installation.revision,
						package: {
							packageId: item.installation.packageId,
							version: item.installation.version,
							packageHash: item.installation.packageHash,
							publisherKeyId: item.installation.publisherKeyId,
						},
					}
				: {
						kind: 'plan',
						plan: {
							initialization: 'declared_grants',
							repositoryVersion: item.plan.repositoryVersion,
							target: {
								repositoryUrl: item.plan.target.repositoryUrl,
								stageId: item.plan.target.stage.id,
								expectedVersion: item.plan.target.stage.version,
								expectedInstallationRevision: item.plan.target.expectedInstallationRevision,
								package: reference(item.plan.target.stage),
							},
							dependencies: item.plan.dependencies.map((dependency) =>
								dependency.kind === 'installed'
									? {
											kind: 'installed',
											expectedRevision: dependency.installation.revision,
											package: {
												packageId: dependency.installation.packageId,
												version: dependency.installation.version,
												packageHash: dependency.installation.packageHash,
												publisherKeyId: dependency.installation.publisherKeyId,
											},
										}
									: {
											kind: 'staged',
											repositoryUrl: dependency.repositoryUrl,
											stageId: dependency.stage.id,
											expectedVersion: dependency.stage.version,
											expectedInstallationRevision: dependency.expectedInstallationRevision,
											package: reference(dependency.stage),
										},
							),
						},
					},
		),
		bindings: plan.bindings.map((item) => ({
			appId: item.appId,
			executionRevision: item.executionRevision,
			uiRevision: item.uiRevision,
		})),
	};
}

async function fixture(t, { signedRequired = true } = {}) {
	const f = await openPlugins((close) => t.after(close));
	const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(
		new URL('../../../../../packages/backend/package.json', import.meta.url),
	)('undici');
	const previous = getGlobalDispatcher();
	const mock = new MockAgent();
	mock.disableNetConnect();
	mock.enableNetConnect(/127\.0\.0\.1/u);
	const official = new URL(OFFICIAL_PLUGIN_SOURCE.catalogUrl);
	mock.get(official.origin)
		.intercept({ path: official.pathname })
		.reply(200, {
			schemaVersion: 2,
			publishers: [
				{
					keyId: OFFICIAL_PLUGIN_SOURCE.publisherKeyId,
					label: 'official',
					publicKeyPem: OFFICIAL_PLUGIN_SOURCE.publisherPublicKeyPem,
				},
			],
			packages: [],
		})
		.persist();
	setGlobalDispatcher(mock);
	t.after(async () => {
		setGlobalDispatcher(previous);
		await mock.close();
	});
	const appId = 'example.required-app';
	const uiId = 'example.required-ui';
	const app = await f.build('required-app', {
		definitionId: appId,
		frontend: false,
		requiredOnEnable: signedRequired,
		capabilities: ['context.read'],
		contributions: {
			app: { entry: appId + '.run', uiContract: 'example.chat', uiApiVersion: 1 },
			tools: false,
			services: false,
			ui: null,
			settings: null,
			skills: [],
		},
	});
	const ui = await f.build('required-ui', {
		definitionId: uiId,
		requiredOnEnable: true,
		capabilities: [],
		contributions: {
			app: null,
			tools: false,
			services: false,
			ui: { contract: 'example.chat', apiVersion: 1 },
			settings: null,
			skills: [],
		},
	});
	const archives = new Map([
		['/app.tar', app],
		['/ui.tar', ui],
	]);
	let catalog;
	const server = createServer((req, res) => {
		const body = archives.get(req.url) ?? Buffer.from(JSON.stringify(catalog));
		res.end(body);
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});
	const url = `http://127.0.0.1:${server.address().port}/catalog.json`;
	catalog = {
		schemaVersion: 2,
		publishers: [{ keyId: f.publisher.keyId, label: f.publisher.label, publicKeyPem: f.publisher.publicKeyPem }],
		packages: [...archives].map(([path, bytes], index) => ({
			packageId: index === 0 ? appId : uiId,
			version: '1.0.0',
			requiredOnEnable: true,
			compatibility: {
				host: { minVersion: '1.0.0', maxVersion: '1.99.99' },
				backendSdk: index === 0 ? 4 : null,
				frontendSdk: index === 0 ? null : 4,
			},
			contributionKinds: [index === 0 ? 'app' : 'ui'],
			displayName: index === 0 ? 'Required App' : 'Required UI',
			description: 'Signed required test package',
			packageUrl: new URL(path, url).href,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			sizeBytes: bytes.length,
			publisherKeyId: f.publisher.keyId,
		})),
	};
	const settings = expectStatus(await f.api('GET', base + '/repositories'), 200);
	expectStatus(
		await f.api('PUT', base + '/repositories', { expectedVersion: settings.version, repositories: [{ url }] }),
		200,
	);
	return {
		...f,
		appId,
		uiId,
		catalog,

		prepare: async () => readAgentPluginEnablePlan(expectStatus(await f.api('POST', onboarding + '/prepare'), 200)),
	};
}

test('required App and separate UI install and compose together; subsequent enable preserves grants and disabled state', async (t) => {
	const f = await fixture(t);
	const plan = await f.prepare();
	assert.equal(plan.ready, false);
	assert.deepEqual(plan.packages.map((item) => item.plan.target.stage.manifest.id).sort(), [f.appId, f.uiId]);
	assert.equal(
		expectStatus(await f.api('GET', base + '/packages'), 200).installations.some(
			(item) => item.packageId === f.appId,
		),
		false,
	);
	const result = readAgentPluginEnableResponse(
		expectStatus(await f.api('POST', onboarding + '/install', command(plan)), 200),
	);
	assert.equal(result.bindings.length, 1);
	assert.equal(result.bindings[0].app.packageId, f.appId);
	assert.equal(result.bindings[0].ui.packageId, f.uiId);
	const path = '/api/v1/agent/apps/' + result.bindings[0].appId;
	const app = expectStatus(await f.api('GET', path), 200);
	assert.equal(app.enabled, true);
	const grants = expectStatus(await f.api('GET', path + '/grants'), 200);
	assert.deepEqual(
		grants.grants.map((item) => item.capability),
		['context.read'],
	);
	expectStatus(
		await f.api('PUT', path + '/grants', { expectedPolicyRevision: grants.policyRevision, grants: [] }),
		200,
	);
	expectStatus(await f.api('PATCH', path, { expectedVersion: app.version, enabled: false }), 200);
	const again = await f.prepare();
	assert.equal(again.ready, true);
	assert.ok(again.packages.every((item) => item.kind === 'installed'));
	expectStatus(await f.api('POST', onboarding + '/install', command(again)), 200);
	assert.equal(expectStatus(await f.api('GET', path), 200).enabled, false);
	assert.deepEqual(expectStatus(await f.api('GET', path + '/grants'), 200).grants, []);
});

test('catalog cannot declare an unsigned requirement', async (t) => {
	const f = await fixture(t, { signedRequired: false });
	expectStatus(await f.api('POST', onboarding + '/prepare'), 403);
	assert.equal(
		expectStatus(await f.api('GET', base + '/packages'), 200).installations.some(
			(item) => item.packageId === f.appId,
		),
		false,
	);
});

test('missing package and stale second target are rejected before the first installation', async (t) => {
	const f = await fixture(t);
	const plan = await f.prepare();
	const missing = command(plan);
	missing.packages.pop();
	expectStatus(await f.api('POST', onboarding + '/install', missing), 409);
	const stale = command(plan);
	stale.packages[1].plan.target.expectedVersion += 1;
	expectStatus(await f.api('POST', onboarding + '/install', stale), 409);
	assert.equal(
		expectStatus(await f.api('GET', base + '/packages'), 200).installations.some(
			(item) => item.packageId === f.appId,
		),
		false,
	);
});

test('failure after one confirmed package keeps it for retry without creating an incomplete App', async (t) => {
	const f = await fixture(t);
	const plan = await f.prepare();
	const install = PluginService.prototype.installPackage;
	const stub = t.mock.method(PluginService.prototype, 'installPackage', async function (actor, stageId, ...rest) {
		const stage = await this.getStage(actor, stageId);
		if (stage.manifest.id === f.uiId) throw new AgentFailure('version_conflict');
		return install.call(this, actor, stageId, ...rest);
	});
	expectStatus(await f.api('POST', onboarding + '/install', command(plan)), 409);
	stub.mock.restore();
	const retry = await f.prepare();
	assert.equal(retry.ready, false);
	assert.equal(retry.packages.find((item) => item.kind === 'installed')?.installation.packageId, f.appId);
	assert.equal(retry.bindings.length, 0);
	const result = readAgentPluginEnableResponse(
		expectStatus(await f.api('POST', onboarding + '/install', command(retry)), 200),
	);
	assert.equal(result.bindings[0].ui.packageId, f.uiId);
	assert.equal((await f.prepare()).ready, true);
});

async function installOptionalApp(f) {
	const manifests = (await f.prepare()).packages.map((item) => item.plan.target.stage.manifest);
	const uiManifest = manifests.find((item) => item.id === f.uiId);
	const appManifest = manifests.find((item) => item.id === f.appId);
	const ui = await f.stage('old-ui', {
		definitionId: f.uiId,
		version: '0.9.0',
		requiredOnEnable: false,
		capabilities: uiManifest.capabilities,
		contributions: uiManifest.contributions,
	});
	expectStatus(await f.api('POST', base + '/packages/install', { stageId: ui.id, expectedVersion: ui.version }), 200);
	return f.install('old-app', {
		definitionId: f.appId,
		version: '0.9.0',
		requiredOnEnable: false,
		frontend: false,
		enabled: false,
		capabilities: appManifest.capabilities,
		contributions: appManifest.contributions,
		uiPackageId: f.uiId,
	});
}

test('upgrading previously optional App and UI completes required onboarding without resetting grants or enabled state', async (t) => {
	const f = await fixture(t);
	const old = await installOptionalApp(f);
	const plan = await f.prepare();
	assert.equal(plan.ready, false);
	assert.equal(plan.bindings[0].appId, old.appId);
	const result = readAgentPluginEnableResponse(
		expectStatus(await f.api('POST', onboarding + '/install', command(plan)), 200),
	);
	assert.equal(result.bindings[0].appId, old.appId);
	assert.equal(result.bindings[0].app.version, '1.0.0');
	assert.equal(result.bindings[0].ui.version, '1.0.0');
	assert.equal(expectStatus(await f.api('GET', old.appPath), 200).enabled, false);
	assert.deepEqual(expectStatus(await f.api('GET', old.appPath + '/grants'), 200).grants, []);
	assert.equal((await f.prepare()).ready, true);
});

test('required upgrade receipts cannot adopt a concurrent composition change', async (t) => {
	const f = await fixture(t);
	const old = await installOptionalApp(f);
	const tool = await f.stage('concurrent-tool', {
		frontend: false,
		backend: "import { definePlugin } from './sdk.mjs'; export default definePlugin(() => {});",
		capabilities: ['context.read'],
		contributions: { app: null, tools: true, services: false, ui: null, settings: null, skills: [] },
	});
	expectStatus(
		await f.api('POST', base + '/packages/install', { stageId: tool.id, expectedVersion: tool.version }),
		200,
	);
	const plan = await f.prepare();
	const update = PluginService.prototype.updatePackage;
	let changed = false;
	t.mock.method(PluginService.prototype, 'updatePackage', async function (...args) {
		const result = await update.apply(this, args);
		if (!changed) {
			changed = true;
			const current = expectStatus(await f.api('GET', base + '/apps/bindings'), 200).bindings.find(
				(item) => item.appId === old.appId,
			);
			expectStatus(
				await f.api('PUT', base + '/apps/' + old.appId + '/composition', {
					packageId: f.appId,
					expectedExecutionRevision: current.executionRevision,
					expectedUiRevision: current.uiRevision,
					selectedRootIds: [tool.manifest.id],
					uiPackageId: f.uiId,
				}),
				200,
			);
		}
		return result;
	});
	expectStatus(await f.api('POST', onboarding + '/install', command(plan)), 409);
	assert.equal(changed, true);
	const current = expectStatus(await f.api('GET', base + '/apps/bindings'), 200).bindings.find(
		(item) => item.appId === old.appId,
	);
	assert.deepEqual(current.selectedRootIds, [tool.manifest.id]);
	assert.equal(expectStatus(await f.api('GET', old.appPath), 200).enabled, false);
	assert.deepEqual(expectStatus(await f.api('GET', old.appPath + '/grants'), 200).grants, []);
});
