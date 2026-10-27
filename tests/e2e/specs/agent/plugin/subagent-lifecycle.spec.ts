import { readAgentExecutionSettingsResponse } from '../../../../../packages/shared/src/agent/execution/http-codec';
import { randomUUID } from 'node:crypto';
import {
	prepareNativeTask,
	openNativeTask,
	startNativeTask,
	finishNativeTask,
	cancelNativeTask,
	readNativeRun,
} from '../../../fixtures/agent/native-task';
import { installTestPlugin } from '../../../support/plugins';
import { requestAgentJson, requestAgentWorkspace } from '../../../support/agent';
import { readAgentErrorResponse } from '../../../../../packages/shared/src/agent/http-codec';
import { expect, test } from '../../../support/fixtures';
import { loginAsInitialAdmin } from '../../../support/auth';
import { step } from '../../../support/steps';
import { E2E_URLS } from '../../../support/test-env';
import {
	enablePluginApp,
	cancelBrowserPhase,
	configureLifecycleBrowser,
	browserControl,
	releaseBrowserCreationBarrier,
	releaseBrowserModel,
	nativeChildren,
	approveNativeFamily,
} from './fixtures';

test.use({ actionTimeout: 10_000 });

test('Nexus Agent subagent lifecycle preserves tool batches and reclaims child Browser contexts', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	const installed = await installTestPlugin(request, 'nexus.agent');
	const app = await enablePluginApp(request, installed.appId);
	const task = await prepareNativeTask(
		request,
		page,
		['app.intents.exchange', 'browser.read', 'browser.interact'],
		[],
		app,
	);
	const browser = await configureLifecycleBrowser(request);
	const configured = await requestAgentJson(
		request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: '/execution-settings',
			data: {
				expectedVersion: configured.settings.version,
				enabled: true,
				limits: configured.settings.limits,
			},
		},
		readAgentExecutionSettingsResponse,
	);
	await openNativeTask(task);
	await step('Child history preserves one assistant turn and both read tool results', async () => {
		const run = await startNativeTask(task, 'E2E_NATIVE_PLUGIN_DELEGATE');
		try {
			const result = await finishNativeTask(task, run.id, ['collaboration_delegate']);
			expect(result.run.status).toBe('completed');
			const report = JSON.parse(result.text);
			expect(report.joined).toMatchObject({
				ready: true,
				children: [{ status: 'completed', output: 'CHILD_BATCH_OK' }],
			});
			const children = await nativeChildren(task, run.id);
			expect(children).toHaveLength(1);
			expect(children[0]).toMatchObject({ parentId: run.id, status: 'completed', profile: 'worker' });
			expect(children[0].id).not.toBe(run.id);
		} finally {
			await cancelNativeTask(task, run.id);
		}
	});
	for (const phase of ['complete', 'cancel-live', 'cancel-creating', 'child-cancel-live', 'child-cancel-creating']) {
		await step(`Child Browser resources settle: ${phase}`, async () => {
			// Refresh the authoritative same-thread view after the previous child
			// Run finished through the API. The mounted composer may otherwise
			// remain disabled against the retired active-run fence.
			await openNativeTask(task);
			const independent = phase.startsWith('child-');
			const creating = phase.endsWith('creating');
			const cancelled = phase !== 'complete';
			const baseline = (await browserControl('/contexts')).browserContextIds;
			if (creating) {
				await browserControl('/creation-barrier', 'POST');
			}
			const run = await startNativeTask(
				task,
				`E2E_NATIVE_PLUGIN_DELEGATE browser=true version=${browser.version}`,
			);
			try {
				try {
					await expect
						.poll(
							async () => {
								await approveNativeFamily(task, run.id, ['collaboration_delegate', 'browser_open']);
								return creating
									? (await browserControl('/creation-barrier')).held
									: (await (await fetch(E2E_URLS.openAiProviderOrigin + '/browser-lifecycle')).json())
											.held;
							},
							{ timeout: 20_000 },
						)
						.toBe(true);
					await expect
						.poll(async () => (await browserControl('/contexts')).browserContextIds)
						.toHaveLength(baseline.length + 1);
					const children = await nativeChildren(task, run.id);
					expect(children).toHaveLength(1);
					if (cancelled) {
						if (independent) {
							const child = children[0];
							await requestAgentJson(
								request,
								{
									method: 'POST',
									path: `/apps/${app.id}/workspace`,
									status: 409,
									data: {
										appVersion: app.version,
										request: {
											method: 'agent.subagents.cancel',
											params: {
												runId: run.id,
												childId: child.id,
												operationId: randomUUID(),
												expectedVersion: child.version + 100,
											},
										},
									},
								},
								(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'version_conflict' }),
							);
							const receipt = await cancelBrowserPhase(
								creating,
								() =>
									requestAgentWorkspace(request, app, {
										method: 'agent.subagents.cancel',
										params: {
											runId: run.id,
											childId: child.id,
											operationId: randomUUID(),
											expectedVersion: child.version,
										},
									}),
								async () =>
									(await nativeChildren(task, run.id)).find((item) => item.id === child.id)
										?.status === 'cancelled',
							);
							if (receipt.method !== 'agent.subagents.cancel') {
								throw new Error('Unexpected Child cancellation');
							}
							expect(receipt.value.run.status).toBe('cancelled');
						} else {
							await cancelBrowserPhase(
								creating,
								() => cancelNativeTask(task, run.id),
								async () => (await readNativeRun(task, run.id)).status === 'cancelled',
							);
						}
					}
				} finally {
					if (creating) {
						await releaseBrowserCreationBarrier();
					}
					await releaseBrowserModel();
				}
				const result = await finishNativeTask(task, run.id);
				expect(result.run.status).toBe(
					cancelled ? (independent ? (creating ? 'unknown' : 'completed') : 'cancelled') : 'completed',
				);
				expect((await nativeChildren(task, run.id))[0].status).toBe(cancelled ? 'cancelled' : 'completed');
				if (!cancelled) {
					expect(result.text).toContain('Browser lifecycle fixture completed.');
				}
				await expect.poll(async () => (await browserControl('/contexts')).browserContextIds).toEqual(baseline);
			} finally {
				await cancelNativeTask(task, run.id);
			}
		});
	}
});
