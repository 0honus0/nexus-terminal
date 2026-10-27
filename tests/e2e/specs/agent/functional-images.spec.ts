import { randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import {
	prepareNativeTask,
	openNativeTask,
	startNativeTask,
	finishNativeTask,
	waitNativeApproval,
	resolveNativeApproval,
} from '../../fixtures/agent/native-task';
import { requestAgentJson } from '../../support/agent';
import { E2E_URLS } from '../../support/test-env';
import { readAgentProviderView } from '../../../../packages/shared/src/agent/providers/http-codec';
import {
	readAgentToolCallDetails,
	readAgentThreadToolsResponse,
} from '../../../../packages/shared/src/agent/tools/http-codec';

test.use({ actionTimeout: 10_000 });

test('image tool shows a persisted preview and download without model-authored Markdown', async ({ request, page }) => {
	const task = await prepareNativeTask(request, page, ['context.read', 'artifacts.read', 'artifacts.write']);
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/ai/providers',
			status: 201,
			data: {
				kind: 'openai-compatible',
				displayName: 'E2E image provider',
				baseUrl: E2E_URLS.openAiProviderOrigin + '/v1',
				protocol: 'images',
				models: [{ id: 'e2e-image', supportsTools: false, supportsImageGeneration: true }],
				enabled: true,
				credential: 'e2e-provider-secret',
			},
		},
		readAgentProviderView,
	);
	const hub = await openNativeTask(task);
	const run = await startNativeTask(task, 'E2E_AUTOMATIC_IMAGE_PREVIEW');
	const approval = await waitNativeApproval(task, run.id, 'image_generate');
	await expect(hub.locator('.agent-generated-image')).toHaveCount(0);
	await resolveNativeApproval(task, approval, 'approved');
	const completed = await finishNativeTask(task, run.id);
	expect(completed.run.status).toBe('completed');
	expect(completed.text).toBe('Image generated and saved.');
	const tools = await requestAgentJson(
		request,
		{ method: 'GET', path: `/apps/${task.app.id}/threads/${task.thread.id}/tools?limit=100` },
		(value) => readAgentThreadToolsResponse(value, task.app.id, null, 100),
	);
	const imageTool = tools.items.find((tool) => tool.toolName === 'image_generate');
	expect(imageTool?.state).toBe('completed');
	expect(imageTool?.generatedImageId).toMatch(/^[a-f0-9-]{36}$/);
	if (!imageTool) throw new Error('Expected persisted image tool');
	const toolPath = { appId: task.app.id, runId: run.id, toolId: imageTool.id };
	const details = await requestAgentJson(
		request,
		{ method: 'GET', path: `/apps/${task.app.id}/runs/${run.id}/tools/${imageTool.id}` },
		(value) => readAgentToolCallDetails(value, toolPath),
	);
	expect(details.tool).toEqual(imageTool);
	expect(details.failureCode).toBeNull();
	expect(JSON.parse(details.argumentsJson)).toEqual(expect.objectContaining({ prompt: expect.any(String) }));
	const wrongRun = await request.get(`/api/v1/agent/apps/${task.app.id}/runs/${randomUUID()}/tools/${imageTool.id}`);
	expect(wrongRun.status()).toBe(404);
	const toolCard = hub.locator('[data-tool-name="image_generate"][data-tool-state]');
	await hub.locator('details.group\\/tools > summary').click();
	await toolCard.locator('summary').click();
	await expect(toolCard.locator('[data-tool-arguments]')).toHaveText(
		JSON.stringify(JSON.parse(details.argumentsJson), null, 2),
	);

	const root = `/api/v1/agent/apps/${task.app.id}/artifacts/${imageTool?.generatedImageId}`;
	const preview = hub.locator('.agent-generated-image img');
	await expect(preview).toHaveAttribute('src', root + '/preview');
	await expect
		.poll(() => preview.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
		.toBe(true);
	await expect(hub.locator('.agent-generated-image__download')).toHaveAttribute('href', root + '/content');
	const download = await request.get(root + '/content');
	expect(download.status()).toBe(200);
	expect(download.headers()['content-type']).toContain('application/octet-stream');
	expect((await download.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
	await page.reload();
	await openNativeTask(task);
	await expect(preview).toHaveAttribute('src', root + '/preview');
	await expect
		.poll(() => preview.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
		.toBe(true);
});

for (const scenario of [
	{ modelId: 'e2e-image-moderation', failureCode: 'model_content_filtered' },
	{ modelId: 'e2e-image-policy', failureCode: 'model_content_filtered' },
	{ modelId: 'e2e-image-unknown-rejection', failureCode: 'model_request_rejected' },
] as const) {
	test(`image tool classifies ${scenario.modelId} without retries, leaked body or a success preview`, async ({
		request,
		page,
	}) => {
		const task = await prepareNativeTask(request, page, ['context.read', 'artifacts.read', 'artifacts.write']);
		await requestAgentJson(
			request,
			{
				method: 'POST',
				path: '/ai/providers',
				status: 201,
				data: {
					kind: 'openai-compatible',
					displayName: 'E2E rejected image provider',
					baseUrl: E2E_URLS.openAiProviderOrigin + '/v1',
					protocol: 'images',
					models: [{ id: scenario.modelId, supportsTools: false, supportsImageGeneration: true }],
					enabled: true,
					credential: 'e2e-provider-secret',
				},
			},
			readAgentProviderView,
		);
		const hub = await openNativeTask(task);
		const run = await startNativeTask(task, 'E2E_AUTOMATIC_IMAGE_PREVIEW');
		const approval = await waitNativeApproval(task, run.id, 'image_generate');
		await resolveNativeApproval(task, approval, 'approved');
		const finished = await finishNativeTask(task, run.id);
		expect(finished.run.status).toBe('unknown');
		expect(finished.run.failure).toEqual({ code: scenario.failureCode, toolName: 'image_generate' });
		expect(finished.text).not.toContain('Image generated and saved.');
		expect(JSON.stringify(finished)).not.toContain('E2E_PRIVATE_VENDOR_BODY');
		const tools = await requestAgentJson(
			request,
			{ method: 'GET', path: `/apps/${task.app.id}/threads/${task.thread.id}/tools?limit=100` },
			(value) => readAgentThreadToolsResponse(value, task.app.id, null, 100),
		);
		expect(tools.items.find((tool) => tool.toolName === 'image_generate')).toMatchObject({
			state: 'unknown',
			generatedImageId: null,
		});
		const rejectedTool = tools.items.find((tool) => tool.toolName === 'image_generate');
		if (!rejectedTool) throw new Error('Expected persisted rejected image tool');
		const details = await requestAgentJson(
			request,
			{ method: 'GET', path: `/apps/${task.app.id}/runs/${run.id}/tools/${rejectedTool.id}` },
			(value) => readAgentToolCallDetails(value, { appId: task.app.id, runId: run.id, toolId: rejectedTool.id }),
		);
		expect(details.failureCode).toBe(scenario.failureCode);
		expect(JSON.stringify(details)).not.toContain('E2E_PRIVATE_VENDOR_BODY');
		await hub.locator('details.group\\/tools > summary').click();
		const toolCard = hub.locator('[data-tool-name="image_generate"][data-tool-state]');
		await toolCard.locator('summary').click();
		await expect(toolCard.locator('[data-tool-arguments]')).toHaveText(
			JSON.stringify(JSON.parse(details.argumentsJson), null, 2),
		);
		await expect(toolCard).toContainText(scenario.failureCode);
		const message =
			scenario.failureCode === 'model_content_filtered'
				? 'The model service rejected the request or generated result during content safety checks. Revise the prompt before submitting again.'
				: 'The model service rejected the request. Check the request content, model type and capability configuration.';
		await expect(hub).toContainText(message);
		await expect(hub.locator('.agent-generated-image')).toHaveCount(0);
		await expect(hub).not.toContainText('E2E_PRIVATE_VENDOR_BODY');
		const attempts = await request.get(E2E_URLS.openAiProviderOrigin + '/image-requests');
		expect(attempts.status()).toBe(200);
		expect(await attempts.json()).toEqual({ [scenario.modelId]: 1 });
		await page.reload();
		await openNativeTask(task);
		await expect(hub).toContainText(message);
		await expect(hub.locator('.agent-generated-image')).toHaveCount(0);
		const afterReload = await request.get(E2E_URLS.openAiProviderOrigin + '/image-requests');
		expect(await afterReload.json()).toEqual({ [scenario.modelId]: 1 });
	});
}
