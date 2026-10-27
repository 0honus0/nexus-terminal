import { readAgentRunUsageResponse } from '../../../../../packages/shared/src/agent/runs/http-codec';
import { readAgentArtifactResponse } from '../../../../../packages/shared/src/agent/artifacts/http-codec';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
	captureNativeCommand,
	prepareNativeTask,
	openNativeTask,
	openNativeTaskPanel,
	startNativeTask,
	finishNativeTask,
	cancelNativeTask,
	readNativeRun,
	waitNativeApproval,
} from '../../../fixtures/agent/native-task';
import { installTestPlugin } from '../../../support/plugins';
import { selectUiOption } from '../../../support/ui-select';
import { openAgentConversations, requestAgentJson, requestAgentWorkspace } from '../../../support/agent';
import { expect, test } from '../../../support/fixtures';
import { loginAsInitialAdmin } from '../../../support/auth';
import { captureFunctionalScreenshot } from '../../../support/functional-screenshots';
import { step } from '../../../support/steps';
import { ensureTestSshConnection } from '../../../support/ssh';
import { E2E_URLS } from '../../../support/test-env';
import { enablePluginApp } from './fixtures';

test.use({ actionTimeout: 10_000 });

test('installed Nexus Agent plugin uses the host-owned Agent surface and captures functional evidence', async ({
	page,
	context,
}) => {
	const request = context.request;
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const installed = await installTestPlugin(request, 'nexus.agent');
	const app = await enablePluginApp(request, installed.appId);
	const task = await prepareNativeTask(
		request,
		page,
		['shell.execute', 'file.read', 'machine.inspect', 'artifacts.read'],
		[connectionId],
		app,
	);
	let hub = await openNativeTask(task);
	await step('the installed definition uses native host UI and durable Run history', async () => {
		const run = await startNativeTask(task, 'E2E_NATIVE_PLUGIN_OK');
		expect((await finishNativeTask(task, run.id)).run.status).toBe('completed');
		await expect(hub.getByText('OK', { exact: true })).toBeVisible();
		await expect(hub.getByRole('button', { name: 'Environment', exact: true })).toHaveCount(0);
		await expect(hub.getByRole('button', { name: 'Execution mode', exact: true })).toHaveCount(0);
		await openNativeTaskPanel(page);
		await hub
			.getByRole('complementary', { name: 'Tasks', exact: true })
			.locator('details > summary')
			.filter({ hasText: /^Technical details$/ })
			.first()
			.click();
		await expect(hub.getByText('Step and tool audit', { exact: true })).toHaveCount(0);
		const usage = await requestAgentJson(
			request,
			{ method: 'GET', path: `/apps/${task.app.id}/runs/${run.id}/usage` },
			readAgentRunUsageResponse,
		);
		expect(usage.runId).toBe(run.id);
		expect(usage.reportedModelRequests).toBeGreaterThan(0);
		await captureFunctionalScreenshot(page, 'agent-installed-native-run.png', {
			viewport: { width: 1440, height: 900 },
		});
		await hub
			.getByRole('complementary', { name: 'Tasks', exact: true })
			.getByRole('button', { name: 'Close', exact: true })
			.click();
	});
	await step('resizing persists host-owned geometry across reload', async () => {
		const handle = hub.getByRole('button', { name: 'Resize Agent', exact: true });
		const before = await hub.boundingBox();
		expect(before).not.toBeNull();
		await handle.focus();
		await handle.press('ArrowLeft');
		await expect.poll(async () => (await hub.boundingBox())!.width).toBeLessThan(before!.width);
		const changed = await hub.boundingBox();
		hub = await openNativeTask(task);
		await expect.poll(async () => Math.abs((await hub.boundingBox())!.width - changed!.width)).toBeLessThan(2);
	});
	await step('create and switch threads in the UI and rename through the versioned workspace API', async () => {
		await openAgentConversations(page);
		const panel = hub.locator('#agent-thread-sidebar');
		const { result } = await captureNativeCommand(task, 'agent.threads.create', () =>
			panel.getByRole('button', { name: 'New', exact: true }).click(),
		);
		if (result.method !== 'agent.threads.create') {
			throw new Error('Unexpected thread creation');
		}
		expect(result.value.title).toBe('Untitled thread');
		await openAgentConversations(page);
		await expect(
			panel.getByRole('button').filter({ has: page.getByText('Untitled thread', { exact: true }) }),
		).toBeVisible();
		const renameResult = await requestAgentWorkspace(request, task.app, {
			method: 'agent.threads.rename',
			params: {
				threadId: result.value.id,
				expectedVersion: result.value.version,
				operationId: randomUUID(),
				title: 'Renamed plugin conversation',
			},
		});
		if (renameResult.method !== 'agent.threads.rename') {
			throw new Error('Unexpected thread rename');
		}
		expect(renameResult.value).toMatchObject({
			id: result.value.id,
			title: 'Renamed plugin conversation',
			version: result.value.version + 1,
		});
		await hub.getByRole('button', { name: 'Minimize Agent', exact: true }).click();
		await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
		await openAgentConversations(page);
		await expect(
			panel.getByRole('button').filter({ has: page.getByText('Renamed plugin conversation', { exact: true }) }),
		).toBeVisible();
		await panel
			.getByRole('button')
			.filter({ has: page.getByText(task.thread.title, { exact: true }) })
			.click();
		await expect(hub.getByText('OK', { exact: true })).toBeVisible();
	});
	await step(
		'old slash/checkpoint/delete APIs stay retired; plain prompts and follow-ups create real Runs',
		async () => {
			for (const suffix of ['/checkpoint', '/goal', '/plan']) {
				const response = await request.post(`/api/v1/apps/nexus.agent/threads/${task.thread.id}${suffix}`, {
					headers: { Origin: E2E_URLS.frontendOrigin },
					data: {},
				});
				expect(response.status()).toBe(404);
			}
			const original = await startNativeTask(task, '/status');
			expect((await finishNativeTask(task, original.id)).text).toBe('OK');
			const followup = await startNativeTask(task, 'E2E_NATIVE_PLUGIN_OK follow-up', [], true);
			expect(followup.id).not.toBe(original.id);
			expect((await finishNativeTask(task, followup.id)).run.status).toBe('completed');
			expect((await readNativeRun(task, original.id)).status).toBe('completed');
			const deleted = await request.delete(`/api/v1/apps/nexus.agent/runs/${original.id}`, {
				headers: { Origin: E2E_URLS.frontendOrigin },
			});
			expect(deleted.status()).toBe(404);
		},
	);
	await step('pending mutation approval is rendered and submits the original hash and version', async () => {
		const run = await startNativeTask(task, `E2E_NATIVE_PLUGIN_APPROVAL connection=${connectionId}`, [
			connectionId,
		]);
		try {
			const approval = await waitNativeApproval(task, run.id, 'shell_execute');
			// Approval delivery opens Tasks automatically. Toggling here races the
			// WebSocket update and can close the panel just as the card arrives.
			await expect(hub.getByRole('button', { name: 'Show or hide task panel', exact: true })).toHaveAttribute(
				'aria-expanded',
				'true',
			);
			await expect(hub.getByRole('complementary', { name: 'Tasks', exact: true })).toBeVisible();
			const article = hub
				.getByRole('complementary', { name: 'Tasks', exact: true })
				.locator('article')
				.filter({ has: page.getByRole('button', { name: 'Approve and run', exact: true }) })
				.filter({ hasText: approval.inspection.toolName });
			await expect(article).toContainText('shell_execute');
			await expect(article).toContainText('Destructive');
			await article.getByRole('button', { name: 'Normalized operation', exact: true }).click();
			await expect(article).toContainText(approval.id);
			await expect(article).toContainText(approval.operationHash);
			await expect(article.getByRole('button', { name: 'Inspect tool audit', exact: true })).toHaveCount(0);
			await expect(article).toContainText('printf approval-e2e');
			const { command: input } = await captureNativeCommand(task, 'agent.approvals.resolve', () =>
				article.getByRole('button', { name: 'Approve and run', exact: true }).click(),
			);
			if (input.request.method !== 'agent.approvals.resolve') {
				throw new Error('Unexpected approval command');
			}
			expect(input.request.params.input).toMatchObject({
				expectedVersion: approval.version,
				operationHash: approval.operationHash,
				decision: 'approved',
			});
			const result = await finishNativeTask(task, run.id);
			expect(result.run.status).toBe('completed');
			expect(JSON.parse(result.text)).toMatchObject({ exitCode: 0, stdout: 'approval-e2e' });
			await expect(article).toHaveCount(0);
			await expect(
				hub.locator('article[data-tool-name="shell_execute"][data-approval-status="approved"]'),
			).toHaveCount(1);
		} finally {
			await cancelNativeTask(task, run.id);
		}
	});
	await step('protocol-invalid dispatched model tools remain unknown without a fabricated success', async () => {
		const run = await startNativeTask(task, 'E2E_NATIVE_PLUGIN_FAIL');
		const result = await finishNativeTask(task, run.id);
		// The provider stream was dispatched before the untrusted tool name was
		// discovered. The durable Run intentionally records an uncertain outcome
		// instead of claiming that all remote effects are proven to have failed.
		expect(result.run.status).toBe('unknown');
		expect(result.text).toBe('');
		await openNativeTaskPanel(page);
		await expect(hub.locator('strong').filter({ hasText: /^Unknown$/ })).toBeVisible();
		await hub
			.getByRole('complementary', { name: 'Tasks', exact: true })
			.getByRole('button', { name: 'Close', exact: true })
			.click();
	});
	await step(
		'uploaded Artifact appears in the actual App library and verified download preserves bytes',
		async () => {
			const bytes = Buffer.from('Plugin native Artifact evidence\n');
			// Upload belongs to the conversation attachment picker; the library
			// manages files that have already been published.
			await hub.getByRole('button', { name: /^Files \(\d+\)$/ }).click();
			const picker = page
				.locator('[data-ui="popover-panel"]')
				.filter({ has: page.locator('input[type="file"]') });
			await expect(picker).toBeVisible();
			await expect(picker.getByRole('button', { name: 'Upload', exact: true })).toBeEnabled();
			// Hub navigation can retire Chromium's CDP response body after a
			// successful PUT. Capture and decode the original request in the route
			// before allowing the UI to navigate; never replay this mutation.
			// The page fixture owns interception until teardown; background Host
			// polling must not race a network-pattern change after this receipt.
			const uploadRoute = `**/api/v1/agent/apps/${app.id}/artifacts/*/content`;
			let uploadedArtifactBody: unknown;
			let capturedArtifactBody = false;
			await page.route(uploadRoute, async (route) => {
				if (route.request().method() !== 'PUT') {
					await route.continue();
					return;
				}
				const upstream = await route.fetch();
				uploadedArtifactBody = await upstream.json();
				capturedArtifactBody = true;
				await route.fulfill({ response: upstream });
			});
			const publication = page.waitForResponse(
				(response) =>
					response.url().includes(`/agent/apps/${app.id}/artifacts/`) &&
					response.url().endsWith('/content') &&
					response.request().method() === 'PUT',
			);
			await picker.locator('input[type="file"]').setInputFiles({
				name: 'plugin-evidence.txt',
				mimeType: 'text/plain',
				buffer: bytes,
			});
			const uploaded = await publication;
			expect(uploaded.status()).toBe(200);
			expect(capturedArtifactBody).toBe(true);
			const artifact = readAgentArtifactResponse(uploadedArtifactBody).artifact;
			expect(artifact).toMatchObject({
				appId: app.id,
				name: 'plugin-evidence.txt',
				status: 'ready',
				sizeBytes: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex'),
			});
			const attachmentSearch = picker.getByRole('searchbox', { name: 'Search files', exact: true });
			await expect(picker.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
			await attachmentSearch.fill('plugin-evidence.txt');
			await attachmentSearch.press('Enter');
			await expect(picker.getByRole('checkbox').filter({ hasText: 'plugin-evidence.txt' })).toBeChecked();
			await page.keyboard.press('Escape');
			await expect(picker).toBeHidden();
			await hub.getByRole('button', { name: 'Files', exact: true }).click();
			const library = hub.getByRole('region', { name: 'Files and Artifact library', exact: true });
			await selectUiOption(library.getByRole('combobox', { name: 'App', exact: true }), app.id);
			const search = library.getByRole('searchbox', { name: 'Search files', exact: true });
			await expect(search).toBeEnabled();
			await search.fill('plugin-evidence.txt');
			await search.press('Enter');
			const row = library
				.locator('article')
				.filter({ has: page.getByTitle('plugin-evidence.txt', { exact: true }) });
			await expect(row).toContainText(artifact.name);
			await expect(row).toContainText(String(artifact.sizeBytes));
			const downloading = page.waitForEvent('download');
			await row.getByRole('button', { name: 'Download', exact: true }).click();
			const download = await downloading;
			expect(download.suggestedFilename()).toBe('plugin-evidence.txt');
			expect(await download.failure()).toBeNull();
			expect(await readFile((await download.path())!)).toEqual(bytes);
			await captureFunctionalScreenshot(page, 'agent-installed-files.png', {
				viewport: { width: 1440, height: 900 },
			});
		},
	);
});
