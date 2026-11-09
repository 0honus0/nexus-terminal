import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildNativePluginPackage } from '../../../../support/native-plugin-package.mjs';
import { withSignedPluginCatalog } from '../../../../support/signed-plugin-catalog.mjs';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { listAgentApprovalHistory } from '../../runs/support/agent-approval-fixture.mjs';
import { expectStatus, openSshd, until } from '../../../../support/protocols/openssh-fixture.mjs';

const artifactRoot = process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir();
const base = '/api/v1/agent/plugins';

const contribution = (ui) => ({
	app: null,
	tools: false,
	services: !ui,
	ui: ui ? { contract: 'nexus.chat', apiVersion: 1 } : null,
	settings: null,
	skills: [],
});

const backend = `import {definePlugin} from './sdk.mjs';
export default definePlugin((plugin)=>plugin.register({kind:'service',key:'test.live-provider.value',contract:'test.live-provider',apiVersion:1,summary:'Exact provider value',instructions:'Return a deterministic value.',inputSchemaJson:'{"type":"object"}',resultSchemaJson:'{"type":"object"}',capabilities:[],tags:[],execution:'pure'},async()=>({value:42})));`;

for (const mode of ['provider', 'ui', 'ui-service', 'session']) {
	const ui = mode === 'ui' || mode === 'ui-service';
	const withBackend = mode !== 'ui';
	const withTransport = mode === 'session';
	await test(
		'SDK4 independent ' +
			(ui
				? withBackend
					? 'UI with a backend service'
					: 'UI'
				: withTransport
					? 'provider with a live protocol session'
					: 'optional provider') +
			' update preserves an active App Run and unrelated instance',
		{ timeout: 60000 },
		async (t) => {
			const directory = await mkdtemp(join(artifactRoot, 'sdk4-update-'));
			const sshd = await openSshd(directory);
			t.after(() => sshd.close());
			const f = await openAgentExecution(directory, sshd, { signal: t.signal });
			t.after(() => f.close());
			const packageId = ui ? 'test.live-ui' : 'test.live-provider';
			const appPath = '/api/v1/agent/apps/' + f.appId;
			const original = expectStatus(await f.api('GET', base + '/apps/bindings'), 200).bindings.find(
				(entry) => entry.appId === f.appId,
			);
			const manifest = JSON.parse(
				await readFile(
					new URL('../../../../e2e/fixtures/agent/plugin-source/nexus.agent/manifest.json', import.meta.url),
					'utf8',
				),
			);
			const parts = contribution(ui);
			if (ui && withBackend) parts.services = true;
			if (withTransport) {
				parts.tools = true;
				parts.services = false;
			}
			if (ui) parts.ui.contract = manifest.contributions.app.uiContract;
			const options = {
				packageId,
				contribution: parts,
				capabilities: withTransport ? ['plugin.invoke', 'service.transport.http'] : [],
				namespaces: [packageId],
				backend: !withBackend
					? null
					: withTransport
						? `import {definePlugin} from './sdk.mjs';
export default definePlugin((plugin)=>plugin.register({kind:'tool',key:'test.live-provider.connection_test',contract:'test.live-provider',apiVersion:1,summary:'Open a retained protocol session',instructions:'Keep the actual HTTP lease until Run completion or provider retirement.',inputSchemaJson:'{"type":"object"}',resultSchemaJson:'{"type":"object"}',capabilities:['service.transport.http'],tags:['initial'],execution:'managed'},async(_input,ctx)=>{
 const session=await ctx.transport.open('retained-session');
 const opened=await ctx.transport.call(session.sessionId,{method:'transport.http.open',params:{grant:session.transport.grant}});
 const response=await ctx.transport.call(session.sessionId,{method:'transport.http.request',params:{leaseId:opened.value.leaseId,method:'POST',headers:[],bodyUtf8:'{}'}});
 let eof=false;
 while(!eof) { const part=await ctx.transport.call(session.sessionId,{method:'transport.http.read',params:{requestId:response.value.requestId}}); eof=part.value.eof; }
 return {content:await ctx.content.put('connection-result',JSON.stringify({connected:true}),'application/json')};
}));`
						: backend.replaceAll('test.live-provider', packageId),
				...(ui
					? {
							frontendEntry: 'frontend/index.html',
							assets: { 'frontend/index.html': '<!doctype html><title>Independent UI</title>' },
						}
					: {}),
				...(withBackend
					? {
							backendAssets: {
								'sdk.mjs': await readFile(
									new URL(
										'../../../../../packages/backend/dist-plugin-sdk/backend-v4.mjs',
										import.meta.url,
									),
								),
							},
						}
					: {}),
			};
			const first = await buildNativePluginPackage(directory, 'Independent package', undefined, {
				...options,
				version: '1.0.0',
			});
			const second = await buildNativePluginPackage(directory, 'Independent package', first.signingKeyPath, {
				...options,
				version: '1.1.0',
			});
			await withSignedPluginCatalog(f.api, [first, second], async (stage, catalog) => {
				const verified = await stage(first);
				expectStatus(
					await f.api('POST', base + '/packages/install', {
						stageId: verified.id,
						expectedVersion: verified.version,
					}),
					200,
				);
				const configured = expectStatus(
					await f.api('PUT', base + '/apps/' + f.appId + '/composition', {
						packageId: original.app.packageId,
						expectedExecutionRevision: original.executionRevision,
						expectedUiRevision: original.uiRevision,
						selectedRootIds: ui ? original.selectedRootIds : [...original.selectedRootIds, packageId],
						uiPackageId: ui ? packageId : original.ui.packageId,
					}),
					200,
				).binding;
				if (ui) {
					assert.equal(
						configured.dependencies.some((entry) => entry.packageId === packageId),
						withBackend,
					);
				}
				if (withTransport) {
					const instances = expectStatus(
						await f.api('GET', base + '/apps/' + f.appId + '/instances'),
						200,
					).instances;
					const instance = instances.find((entry) => entry.packageId === packageId);
					assert.ok(instance);
					const connectionPath = base + '/apps/' + f.appId + '/instances/' + instance.id + '/connection';
					const connection = expectStatus(await f.api('GET', connectionPath), 200);
					expectStatus(
						await f.api('PUT', connectionPath, {
							expectedRevision: connection.revision,
							connector: {
								kind: 'http',
								endpoint: catalog.repositoryUrl,
								privateAuthorities: [new URL(catalog.repositoryUrl).host],
							},
							credential: { action: 'clear' },
						}),
						200,
					);
				}
				await f.grants(withTransport ? ['context.read', 'service.transport.http'] : ['context.read']);
				const run = await f.start('Keep App running while replacing a package', (results) =>
					withTransport && !results.length
						? { name: { packageId, name: 'connection_test' }, input: {} }
						: { hold: true },
				);
				await until(
					async () => {
						if (withTransport)
							for (const approval of await listAgentApprovalHistory(f.api, f.appId, run.id))
								if (approval.status === 'requested') await f.approve(approval);
						await f.wait(run, 'running', t.signal);
						return f.heldModelCount;
					},
					(count) => count === 1,
					'Model is actually executing',
					t.signal,
				);
				const db = new DatabaseSync(f.database, { readOnly: true });

				const instances = () =>
					db
						.prepare(
							"SELECT package_id,instance_id,generation FROM agent_plugin_runtime_instances WHERE app_id=? AND state='active' ORDER BY package_id,instance_id",
						)
						.all(f.appId);

				const before = instances();
				assert.equal(
					before.some((entry) => entry.package_id === packageId),
					withBackend,
				);
				if (withTransport)
					assert.equal(
						db
							.prepare(
								"SELECT COUNT(*) AS n FROM agent_operations WHERE run_id=? AND label='transport.session' AND state='dispatched'",
							)
							.get(run.id).n,
						1,
					);
				const main = before.find((entry) => entry.package_id === original.app.packageId);
				assert.ok(main);
				const staged = await stage(second);
				const installation = expectStatus(await f.api('GET', base + '/packages'), 200).installations.find(
					(entry) => entry.packageId === packageId,
				);
				const preparation = expectStatus(
					await f.api('POST', base + '/packages/' + packageId + '/prepare-update', {
						expectedRevision: installation.revision,
						stageId: staged.id,
						expectedStageVersion: staged.version,
					}),
					200,
				);
				assert.equal(expectStatus(await f.api('GET', appPath + '/runs/' + run.id), 200).status, 'running');
				const updated = expectStatus(
					await f.api('POST', base + '/packages/' + packageId + '/update', {
						expectedRevision: preparation.installation.revision,
						stageId: staged.id,
						expectedStageVersion: staged.version,
						dependencies: preparation.dependencies,
					}),
					200,
				).installation;
				assert.equal(updated.version, '1.1.0');
				assert.deepEqual(
					instances().find((entry) => entry.package_id === original.app.packageId),
					main,
				);
				if (withBackend) {
					const old = before.find((entry) => entry.package_id === packageId);
					const current = instances().find((entry) => entry.package_id === packageId);
					assert.ok(old && current);
					assert.notEqual(current.generation, old.generation);
				}
				if (withTransport)
					assert.equal(
						db
							.prepare(
								"SELECT COUNT(*) AS n FROM agent_operations WHERE run_id=? AND label='transport.session' AND state='completed'",
							)
							.get(run.id).n,
						1,
					);
				db.close();
				assert.ok(
					expectStatus(await f.api('GET', '/api/v1/agent/apps'), 200).some(
						(entry) => entry.id === f.appId && entry.enabled,
					),
				);
				f.finishModels();
				await f.wait(run, 'completed');
				const nextRun = await f.start('New Run after independent update', () => ({
					text: 'New generation is usable',
				}));
				await f.wait(nextRun, 'completed');
			});
		},
	);
}
