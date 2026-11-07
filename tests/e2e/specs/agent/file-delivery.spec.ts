import { hasToolIdentity, expectedToolIdentity } from '../../../support/package-tool-catalog.mjs';
import { agentHost } from '../../fixtures/agent/workbench';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import imageData from '../../fixtures/agent/image-data.json';
import { expect, test, type Locator } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection } from '../../support/ssh';
import { requestAgentJson } from '../../support/agent-request';
import {
	readAgentThreadToolsResponse,
	readAgentToolCallDetails,
} from '../../../../packages/shared/src/agent/tools/http-codec';
import { readAgentArtifactListResponse } from '../../../../packages/shared/src/agent/artifacts/http-codec';
import {
	prepareNativeTask,
	openNativeTask,
	startNativeTask,
	finishNativeTask,
	waitNativeApproval,
	resolveNativeApproval,
	cancelNativeTask,
	type NativeTask,
} from '../../fixtures/agent/native-task';
import { E2E_URLS } from '../../support/test-env';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const project = path.resolve(__dirname, '../../.tmp/ssh-root/file-delivery');
const files = [
	{ name: 'animation.gif', bytes: Buffer.from(imageData.animatedGifBase64, 'base64'), mediaType: 'image/gif' },
	{
		name: 'report.md',
		bytes: Buffer.from('# Delivered report\nExact remote content.\n'),
		mediaType: 'application/octet-stream',
	},
	{ name: 'large.bin', bytes: Buffer.alloc(256 * 1024, 0xa5), mediaType: 'application/octet-stream' },
	{ name: 'empty.txt', bytes: Buffer.alloc(0), mediaType: 'application/octet-stream' },
];

async function tools(task: NativeTask) {
	return (
		await requestAgentJson(
			task.request,
			{ method: 'GET', path: `/apps/${task.app.id}/threads/${task.thread.id}/tools?limit=100` },
			(value) => readAgentThreadToolsResponse(value, task.app.id, null, 100),
		)
	).items;
}

async function artifacts(task: NativeTask) {
	return (
		await requestAgentJson(
			task.request,
			{ method: 'GET', path: `/apps/${task.app.id}/artifacts` },
			readAgentArtifactListResponse,
		)
	).items;
}

async function closeTaskPanel(hub: Locator): Promise<void> {
	const panel = hub.getByRole('complementary', { name: 'Tasks', exact: true });
	if (await panel.isVisible()) await panel.getByRole('button', { name: 'Close', exact: true }).click();
}

for (const width of [320, 390, 1440]) {
	test(`model text delivery previews, downloads and reuses an existing file at ${width}px`, async ({
		request,
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		const task = await prepareNativeTask(request, page, ['artifacts.write', 'artifacts.read']);
		let hub = await openNativeTask(task);
		const created = await startNativeTask(task, 'E2E_CREATE_DELIVERY');
		const approval = await waitNativeApproval(task, created.id, 'artifact_create');
		await expect(hub.locator('[data-tool-artifact]')).toHaveCount(0);
		await resolveNativeApproval(task, approval, 'approved');
		expect((await finishNativeTask(task, created.id)).run.status).toBe('completed');
		const record = (await tools(task)).find((tool) => hasToolIdentity(tool, 'artifact_create'));
		if (!record?.outputArtifactIds[0]) throw new Error('Expected saved text file reference');
		const card = hub.locator('[data-tool-artifact]');
		await expect(card).toContainText('report.md');
		await closeTaskPanel(hub);
		await testInfo.attach('delivered-file-card', { body: await page.screenshot(), contentType: 'image/png' });
		await card.getByRole('button', { name: 'Preview', exact: true }).click();
		const preview = hub.getByRole('dialog', { name: 'Preview', exact: true });
		await expect(preview).toBeVisible();
		await expect(preview).toContainText('Saved by the model.');
		const bounds = await preview.boundingBox();
		expect(bounds).not.toBeNull();
		if (bounds === null) throw new Error('Preview is not laid out');
		expect(bounds.x).toBeGreaterThanOrEqual(0);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
		await testInfo.attach('delivered-file-preview', { body: await page.screenshot(), contentType: 'image/png' });
		await preview.getByRole('button', { name: 'Close preview', exact: true }).click();
		const waiting = page.waitForEvent('download');
		await card.getByRole('link', { name: 'Download', exact: true }).click();
		const download = await waiting;
		expect(download.suggestedFilename()).toBe('report.md');
		const downloaded = await download.path();
		if (!downloaded) throw new Error('Expected downloaded file');
		expect(await readFile(downloaded, 'utf8')).toBe('# Delivered report\nSaved by the model.\n');
		const presented = await startNativeTask(task, `E2E_PRESENT_FILE artifact=${record.outputArtifactIds[0]}`);
		expect((await finishNativeTask(task, presented.id)).run.status).toBe('completed');
		expect((await tools(task)).find((tool) => tool.runId === presented.id)).toMatchObject({
			identity: expect.objectContaining({ kind: 'plugin', ...expectedToolIdentity('artifact_present') }),
			outputArtifactIds: record.outputArtifactIds,
			mutation: false,
		});
		expect(await artifacts(task)).toHaveLength(1);
		await page.reload();
		hub = await openNativeTask(task);
		await expect(hub.locator('[data-tool-artifact]')).toHaveCount(2);
		await expect(hub.locator('[data-tool-artifact]').last()).toContainText('report.md');
	});
}

for (const file of files) {
	test(`SSH delivery preserves ${file.name} bytes and a durable authorized file reference`, async ({
		request,
		page,
	}) => {
		await loginAsInitialAdmin(request);
		const connectionId = await ensureTestSshConnection(request);
		const task = await prepareNativeTask(request, page, ['file.read', 'artifacts.write'], [connectionId]);
		await mkdir(project);
		await writeFile(path.join(project, file.name), file.bytes);
		let runId: string | undefined;
		try {
			const hub = await openNativeTask(task);
			const created = await startNativeTask(
				task,
				`E2E_DELIVER_FILE connection=${connectionId} path=/file-delivery/${file.name}`,
				[connectionId],
			);
			runId = created.id;
			const approval = await waitNativeApproval(task, created.id, 'file_deliver');
			expect(JSON.parse(approval.summary)).toEqual({
				action: 'deliver',
				paths: ['/file-delivery/' + file.name],
			});
			await expect(hub.locator('[data-tool-artifact]')).toHaveCount(0);
			expect(await artifacts(task)).toHaveLength(0);
			await resolveNativeApproval(task, approval, 'approved');
			const completed = await finishNativeTask(task, created.id);
			expect(completed.run.status).toBe('completed');
			const delivered = JSON.parse(completed.text);
			expect(delivered).toEqual({
				id: expect.stringMatching(/^[a-f0-9-]{36}$/),
				name: file.name,
				sizeBytes: file.bytes.byteLength,
				sha256: hash(file.bytes),
			});
			const record = (await tools(task)).find((tool) => hasToolIdentity(tool, 'file_deliver'));
			expect(record).toMatchObject({
				state: 'completed',
				outputArtifactIds: [delivered.id],
				targetId: connectionId,
			});
			expect(await artifacts(task)).toEqual([
				expect.objectContaining({
					id: delivered.id,
					name: file.name,
					mediaType: file.mediaType,
					sha256: hash(file.bytes),
					status: 'ready',
				}),
			]);
			const root = `/api/v1/agent/apps/${task.app.id}/artifacts/${delivered.id}`;
			const response = await request.get(root + '/content');
			expect(response.status()).toBe(200);
			expect(await response.body()).toEqual(file.bytes);
			expect(await readFile(path.join(project, file.name))).toEqual(file.bytes);
			if (file.mediaType === 'image/gif') {
				const inline = await request.get(root + '/preview');
				expect(inline.headers()['content-type']).toContain('image/gif');
				expect(await inline.body()).toEqual(file.bytes);
				const image = hub.locator('[data-tool-artifact] img');
				await expect
					.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth))
					.toBe(4);
			} else {
				await expect(hub.locator('[data-tool-artifact]')).toContainText(file.name);
				await expect(hub.locator('[data-tool-artifact] a[download]')).toHaveAttribute(
					'href',
					root + '/content',
				);
				expect((await request.get(root + '/preview')).status()).toBe(404);
			}

			const expectDeliveryBeforeSummary = async () => {
				const summary = hub.locator('[data-agent-message]').filter({ hasText: completed.text });
				await expect(summary).toBeVisible();
				await expect
					.poll(async () => {
						const [cardBounds, summaryBounds] = await Promise.all([
							hub.locator('[data-tool-artifact]').boundingBox(),
							summary.boundingBox(),
						]);
						return (
							cardBounds !== null &&
							summaryBounds !== null &&
							cardBounds.y + cardBounds.height <= summaryBounds.y
						);
					})
					.toBe(true);
			};

			// Tool-only steps are displayed before the model's next step, including after reload.
			await expectDeliveryBeforeSummary();
			await page.reload();
			await openNativeTask(task);
			await expect(hub.locator('[data-tool-artifact]')).toHaveAttribute('data-artifact-id', delivered.id);
			await expectDeliveryBeforeSummary();
			if (file.mediaType === 'image/gif') {
				await expect
					.poll(() =>
						hub
							.locator('[data-tool-artifact] img')
							.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth),
					)
					.toBe(4);
			}
		} finally {
			if (runId) await cancelNativeTask(task, runId);
			await rm(project, { recursive: true, force: true });
		}
	});
}

for (const missing of ['file.read', 'artifacts.write', 'selected-target', 'approval'] as const) {
	test(`SSH file delivery without ${missing} never creates or displays a file`, async ({ request, page }) => {
		await loginAsInitialAdmin(request);
		const connectionId = await ensureTestSshConnection(request);
		const grants = (['file.read', 'artifacts.write'] as const).filter((capability) => capability !== missing);
		const task = await prepareNativeTask(request, page, grants, [connectionId]);
		await mkdir(project);
		await writeFile(path.join(project, 'sentinel.txt'), 'keep');
		let runId: string | undefined;
		try {
			const hub = await openNativeTask(task);
			const run = await startNativeTask(
				task,
				`E2E_DELIVER_FILE connection=${connectionId} path=/file-delivery/sentinel.txt`,
				missing === 'selected-target' ? [] : [connectionId],
			);
			runId = run.id;
			if (missing === 'approval') {
				const approval = await waitNativeApproval(task, run.id, 'file_deliver');
				await resolveNativeApproval(task, approval, 'denied');
			}
			const finished = await finishNativeTask(task, run.id);
			// Deliberately emitting a tool excluded from the offered catalog is an
			// invalid provider response; it must never reach tool dispatch.
			expect(finished.run.status).toBe(missing === 'approval' ? 'failed' : 'unknown');
			if (missing !== 'approval') {
				expect(finished.run.failure?.code).toBe('model_response_invalid');
				expect(await tools(task)).toEqual([]);
			}
			expect(await artifacts(task)).toHaveLength(0);
			expect((await tools(task)).every((tool) => tool.outputArtifactIds.length === 0)).toBe(true);
			await expect(hub.locator('[data-tool-artifact]')).toHaveCount(0);
			expect(await readFile(path.join(project, 'sentinel.txt'), 'utf8')).toBe('keep');
		} finally {
			if (runId) await cancelNativeTask(task, runId);
			await rm(project, { recursive: true, force: true });
		}
	});
}

for (const invalid of ['directory', 'symlink']) {
	test(`SSH delivery rejects a ${invalid} without publishing an Artifact`, async ({ request, page }) => {
		await loginAsInitialAdmin(request);
		const connectionId = await ensureTestSshConnection(request);
		const task = await prepareNativeTask(request, page, ['file.read', 'artifacts.write'], [connectionId]);
		await mkdir(project);
		await writeFile(path.join(project, 'sentinel.txt'), 'keep');
		if (invalid === 'symlink') await symlink('sentinel.txt', path.join(project, 'entry'));
		else await mkdir(path.join(project, 'entry'));
		let runId: string | undefined;
		try {
			const hub = await openNativeTask(task);
			const run = await startNativeTask(
				task,
				`E2E_DELIVER_FILE connection=${connectionId} path=/file-delivery/entry`,
				[connectionId],
			);
			runId = run.id;
			expect((await finishNativeTask(task, run.id, ['file_deliver'])).run.status).toBe('unknown');
			expect(await artifacts(task)).toHaveLength(0);
			const rejected = (await tools(task)).find((tool) => hasToolIdentity(tool, 'file_deliver'));
			expect(rejected?.outputArtifactIds).toEqual([]);
			if (!rejected) throw new Error('Expected rejected delivery record');
			const toolPath = { appId: task.app.id, runId: run.id, toolId: rejected.id };
			const details = await requestAgentJson(
				request,
				{ method: 'GET', path: `/apps/${task.app.id}/runs/${run.id}/tools/${rejected.id}` },
				(value) => readAgentToolCallDetails(value, toolPath),
			);
			expect(details.failureCode).toBe('tool_invalid_input');
			await expect(hub.locator('[data-tool-artifact]')).toHaveCount(0);
			expect(await readFile(path.join(project, 'sentinel.txt'), 'utf8')).toBe('keep');
		} finally {
			if (runId) await cancelNativeTask(task, runId);
			await rm(project, { recursive: true, force: true });
		}
	});
}

test('cancelled delivery closes a held SSH read and publishes no success card', async ({ request, page }) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const task = await prepareNativeTask(request, page, ['file.read', 'artifacts.write'], [connectionId]);
	await mkdir(project);
	await writeFile(path.join(project, 'held.bin'), Buffer.alloc(128 * 1024, 0xa5));
	const hold = E2E_URLS.sshControlOrigin + '/sftp/read-hold';
	let runId: string | undefined;
	try {
		expect((await request.post(hold + '?blocked=1')).ok()).toBe(true);
		const hub = await openNativeTask(task);
		const run = await startNativeTask(
			task,
			`E2E_DELIVER_FILE connection=${connectionId} path=/file-delivery/held.bin`,
			[connectionId],
		);
		runId = run.id;
		await resolveNativeApproval(task, await waitNativeApproval(task, run.id, 'file_deliver'), 'approved');
		await expect.poll(async () => (await (await request.get(hold)).json()).pending).toBeGreaterThan(0);
		await cancelNativeTask(task, run.id);
		await expect.poll(async () => (await (await request.get(hold)).json()).pending).toBe(0);
		await expect
			.poll(async () => {
				const handles = await (await request.get(E2E_URLS.sshControlOrigin + '/sftp/read-handles')).json();
				return handles.opened - handles.closed;
			})
			.toBe(0);
		expect((await tools(task)).every((tool) => tool.outputArtifactIds.length === 0)).toBe(true);
		await expect(hub.locator('[data-tool-artifact]')).toHaveCount(0);
		expect(await artifacts(task)).toHaveLength(0);
	} finally {
		expect((await request.post(hold + '?blocked=0')).ok()).toBe(true);
		if (runId) await cancelNativeTask(task, runId);
		await rm(project, { recursive: true, force: true });
	}
});
