import { randomUUID } from 'node:crypto';
import {
	resolveNativeApproval,
	prepareNativeTask,
	openNativeTask,
	startNativeTask,
	finishNativeTask,
	cancelNativeTask,
	readNativeRun,
	waitNativeApproval,
} from '../../../fixtures/agent/native-task';
import { installTestPlugin } from '../../../support/plugins';
import { requestAgentWorkspace } from '../../../support/agent';
import { expect, test } from '../../../support/fixtures';
import { loginAsInitialAdmin } from '../../../support/auth';
import { step } from '../../../support/steps';
import { ensureTestSshConnection } from '../../../support/ssh';
import { E2E_URLS } from '../../../support/test-env';
import {
	enablePluginApp,
	cancelBrowserPhase,
	configureLifecycleBrowser,
	browserControl,
	releaseBrowserCreationBarrier,
	releaseBrowserModel,
} from './fixtures';

test.use({ actionTimeout: 10_000 });

test('Nexus Agent Browser lifecycle cases reclaim contexts across cancellation and approval boundaries', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const installed = await installTestPlugin(request, 'nexus.agent');
	const app = await enablePluginApp(request, installed.appId);
	const task = await prepareNativeTask(
		request,
		page,
		['browser.read', 'browser.interact', 'shell.execute'],
		[connectionId],
		app,
	);
	const browser = await configureLifecycleBrowser(request);
	await openNativeTask(task);
	for (const phase of ['cancel-creating', 'complete', 'cancel-live', 'repeat', 'cancel-approval', 'approve']) {
		await step(`Root Browser cleanup: ${phase}`, async () => {
			// The prior Run is terminated by the separately authenticated API
			// owner. Re-read the same persisted thread before composing a new Run;
			// an already-mounted composer can still display the old active fence.
			await openNativeTask(task);
			const creating = phase === 'cancel-creating';
			const approval = phase === 'cancel-approval' || phase === 'approve';
			const cancel = phase.startsWith('cancel-');
			const baseline = (await browserControl('/contexts')).browserContextIds;
			if (creating) {
				await browserControl('/creation-barrier', 'POST');
			}
			const run = await startNativeTask(
				task,
				`E2E_BROWSER_LIFECYCLE ${randomUUID()} version=${browser.version}${approval ? ' E2E_BROWSER_APPROVAL=' + connectionId : ''}`,
				[connectionId],
			);
			try {
				try {
					const open = await waitNativeApproval(task, run.id, 'browser_open');
					await resolveNativeApproval(task, open, 'approved');
					if (creating) {
						await expect.poll(async () => (await browserControl('/creation-barrier')).held).toBe(true);
					} else if (approval) {
						await waitNativeApproval(task, run.id, 'shell_execute');
					} else {
						await expect
							.poll(
								async () =>
									(await (await fetch(E2E_URLS.openAiProviderOrigin + '/browser-lifecycle')).json())
										.held,
							)
							.toBe(true);
					}
					await expect
						.poll(async () => (await browserControl('/contexts')).browserContextIds)
						.toHaveLength(baseline.length + 1);
					expect((await readNativeRun(task, run.id)).status).toBe('running');
					if (cancel) {
						await cancelBrowserPhase(
							creating,
							() => cancelNativeTask(task, run.id),
							async () => (await readNativeRun(task, run.id)).status === 'cancelled',
						);
					} else if (approval) {
						await resolveNativeApproval(
							task,
							await waitNativeApproval(task, run.id, 'shell_execute'),
							'approved',
						);
						await expect
							.poll(
								async () =>
									(await (await fetch(E2E_URLS.openAiProviderOrigin + '/browser-lifecycle')).json())
										.held,
							)
							.toBe(true);
					}
				} finally {
					if (creating) {
						await releaseBrowserCreationBarrier();
					}
					await releaseBrowserModel();
				}
				const result = await finishNativeTask(task, run.id);
				expect(result.run.status).toBe(cancel ? 'cancelled' : 'completed');
				if (!cancel) {
					expect(result.text).toBe('Browser lifecycle fixture completed.');
				}
				await expect.poll(async () => (await browserControl('/contexts')).browserContextIds).toEqual(baseline);
				if (phase === 'cancel-approval') {
					const approvals = await requestAgentWorkspace(request, app, {
						method: 'agent.approvals.list',
						params: { runId: run.id, after: null },
					});
					if (approvals.method !== 'agent.approvals.list') {
						throw new Error('Unexpected approvals');
					}
					expect(approvals.value.hasMore).toBe(false);
					expect(
						approvals.value.items.filter((item) => item.inspection.toolName === 'shell_execute'),
					).toHaveLength(1);
					expect(
						approvals.value.items.find((item) => item.inspection.toolName === 'shell_execute')!.consumedAt,
					).toBeNull();
				}
			} finally {
				await cancelNativeTask(task, run.id);
			}
		});
	}
});
