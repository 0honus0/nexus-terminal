import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from '../../support/agent-host/sandbox-fixtures.mjs';
import { openPlugins } from '../../../backend/agent/plugins/support/plugin-management-fixture.mjs';
import { openPluginBrowser } from '../../support/agent-host/sandbox-browser.mjs';
import { expectStatus, until } from '../../../support/protocols/openssh-fixture.mjs';
import { AGENT_THREAD_ENTRY_MAX_PAGE } from '../../../../packages/shared/dist/agent/scope/values.js';
test('Agent modular: UI-only package replacement revokes the old view and preserves an active Run', async ({
	context,
	registerCleanup,
}) => {
	test.setTimeout(90_000);
	const f = await openPlugins(registerCleanup);
	const uiId = 'isolated.ui-update';

	async function stageUi(version) {
		const bytes = await f.build('independent-ui', {
			definitionId: uiId,
			version,
			backend: null,
			contributions: {
				app: null,
				tools: false,
				services: false,
				ui: { contract: 'nexus.ui.chat', apiVersion: 1 },
				settings: null,
				skills: [],
			},
			frontendMarkup:
				'<!doctype html><title>UI ' + version + '</title><script type="module" src="./client.mjs"></script>',
		});
		const artifact = await f.upload(f.source.id, bytes);
		const stage = expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/stage', {
				artifactAppId: f.source.id,
				artifactId: artifact.id,
				expectedVersion: artifact.version,
			}),
			200,
		);
		return expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/verify', {
				stageId: stage.id,
				expectedVersion: stage.version,
			}),
			200,
		);
	}

	const initial = await stageUi('1.0.0');
	const { installation: uiPackage } = expectStatus(
		await f.api('POST', '/api/v1/agent/plugins/packages/install', {
			stageId: initial.id,
			expectedVersion: initial.version,
		}),
		200,
	);
	const plugin = await f.install('ui-execution-owner', {
		frontend: false,
		modelApp: true,
		uiPackageId: uiId,
	});
	await plugin.grants(['plugin.invoke']);
	const b = await openPluginBrowser(registerCleanup, context, f, plugin, { holdModel: true });
	let frame = await b.frame();
	assert.equal(await frame.title(), 'UI 1.0.0');
	const provider = expectStatus(
		await f.api('POST', '/api/v1/agent/ai/providers', {
			kind: 'openai-compatible',
			displayName: 'UI update provider',
			baseUrl: b.modelUrl,
			protocol: 'chat-completions',
			models: [{ id: 'fixture', contextWindow: 8192, maxOutputTokens: 256, supportsTools: false }],
			enabled: true,
			credential: 'isolated-ui-update-key',
		}),
		201,
	);
	const settings = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
	expectStatus(
		await f.api('PUT', '/api/v1/agent/execution-settings', {
			expectedVersion: settings.version,
			enabled: true,
			limits: settings.limits,
		}),
		200,
	);
	const thread = expectStatus(
		await f.api('POST', plugin.appPath + '/threads', { title: 'UI update active Run' }),
		201,
	);
	const { run } = expectStatus(
		await f.api(
			'POST',
			plugin.appPath + '/threads/' + thread.id + '/runs',
			{
				prompt: 'Continue across UI replacement',
				approvalMode: 'ask',
				connectionIds: [],
				inputJson: JSON.stringify({
					model: {
						providerId: provider.id,
						modelId: 'fixture',
						configurationVersion: provider.version,
						reasoningEffort: null,
					},
					artifacts: [],
				}),
			},
			{ 'Idempotency-Key': randomUUID() },
		),
		201,
	);
	await until(
		() => b.heldModelCount,
		(count) => count === 1,
		'real model response remains active',
	);
	await frame.evaluate((runId) => {
		window.streamFailures = [];
		window.oldSubscription = window.sdk.agent.runs.subscribe(
			runId,
			0,
			() => {},
			(error) => window.streamFailures.push(error.code),
		);
	}, run.id);
	await b.page.waitForFunction(() =>
		window.bridge.requests.some((item) => item.type === 'nexus.plugin.stream' && item.command === 'ack'),
	);
	const appBefore = expectStatus(await f.api('GET', plugin.appPath), 200);

	const binding = async () =>
		expectStatus(await f.api('GET', '/api/v1/agent/plugins/apps/bindings'), 200).bindings.find(
			(item) => item.appId === plugin.appId,
		);

	const before = await binding();
	const descriptorPath = '/api/v1/agent/plugins/installations/' + plugin.appId + '/descriptor';
	const oldDescriptor = expectStatus(await f.api('GET', descriptorPath), 200);
	const next = await stageUi('1.1.0');
	const preparation = expectStatus(
		await f.api('POST', '/api/v1/agent/plugins/packages/' + uiId + '/prepare-update', {
			expectedRevision: uiPackage.revision,
			stageId: next.id,
			expectedStageVersion: next.version,
		}),
		200,
	);
	const updated = expectStatus(
		await f.api('POST', '/api/v1/agent/plugins/packages/' + uiId + '/update', {
			expectedRevision: preparation.installation.revision,
			dependencies: preparation.dependencies,
			stageId: next.id,
			expectedStageVersion: next.version,
		}),
		200,
	).installation;
	assert.equal(updated.version, '1.1.0');
	const after = await binding();
	assert.equal(after.executionRevision, before.executionRevision);
	assert.ok(after.uiRevision > before.uiRevision);
	assert.equal(after.ui.version, '1.1.0');
	assert.equal(expectStatus(await f.api('GET', plugin.appPath), 200).version, appBefore.version);
	assert.equal(expectStatus(await f.api('GET', plugin.appPath + '/runs/' + run.id), 200).status, 'running');
	expectStatus(await f.anonymous('GET', oldDescriptor.url), 403);
	await frame.waitForFunction(() => window.streamFailures.length > 0);
	assert.deepEqual(
		await frame.evaluate(() => window.streamFailures),
		['forbidden'],
		'revoking the old UI grant closes an idle active stream',
	);
	frame = await b.frame();
	assert.equal(await frame.title(), 'UI 1.1.0');
	const active = await frame.evaluate(
		(runId) => window.sdk.request({ method: 'agent.runs.get', params: { runId } }),
		run.id,
	);
	assert.equal(active.value.status, 'running');
	b.finishModels();
	await until(
		async () => expectStatus(await f.api('GET', plugin.appPath + '/runs/' + run.id), 200).status,
		(status) => status === 'completed',
		'the original Run completes after the UI replacement',
	);
	const entries = await frame.evaluate(
		({ threadId, limit }) =>
			window.sdk.request({
				method: 'agent.threads.entries',
				params: {
					threadId,
					after: { runSequence: 0, messageOrdinal: 0, chunkIndex: 0, textOffset: 0 },
					limit,
				},
			}),
		{ threadId: thread.id, limit: AGENT_THREAD_ENTRY_MAX_PAGE },
	);
	assert.match(
		entries.value.items
			.filter((item) => item.role === 'assistant')
			.map((item) => item.text)
			.join(''),
		/UI update prefix SDK subscription complete/,
	);
	assert.equal(b.modelCalls.length, 1, 'replacing and reconnecting a view does not replay accepted work');
});
