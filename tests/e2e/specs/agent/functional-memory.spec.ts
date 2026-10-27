import regressionInputs from '../../fixtures/agent/regression-inputs.json';
import { expect, test } from '../../support/fixtures';
import { prepareNativeTask, openNativeTask, startNativeTask, finishNativeTask } from '../../fixtures/agent/native-task';
import { requestAgentJson, requestAgentWorkspace } from '../../support/agent';
import {
	readAgentMemoryListResponse,
	readAgentMemoryResponse,
} from '../../../../packages/shared/src/agent/memory/http-codec';
import { readAgentErrorResponse, readAgentId } from '../../../../packages/shared/src/agent/http-codec';
import { readAgentThreadToolsResponse } from '../../../../packages/shared/src/agent/tools/http-codec';

test.use({ actionTimeout: 10_000 });

for (const fixture of regressionInputs.memoryProposals) {
	test(`recorded ${fixture.id} preserves management confidence and independently reviews a model candidate`, async ({
		request,
		page,
	}) => {
		const task = await prepareNativeTask(request, page, ['memory.propose']);
		await openNativeTask(task);
		const created = await startNativeTask(
			task,
			`E2E_REGRESSION_${fixture.id}: propose this untrusted memory: ${fixture.content}`,
		);
		const result = await finishNativeTask(task, created.id, ['memory_propose']);
		expect(result.run.status).toBe('completed');
		const candidate = JSON.parse(result.text);
		readAgentId(candidate.id);
		expect(candidate).toEqual({ id: candidate.id, status: 'candidate', version: 1 });
		const path = `/apps/${task.app.id}/memories`;
		const modelList = await requestAgentJson(
			request,
			{ method: 'GET', path: path + '?status=candidate&limit=20&offset=0' },
			readAgentMemoryListResponse,
		);
		const modelCandidate = modelList.items.find((memory) => memory.id === candidate.id);
		expect(modelCandidate).toMatchObject({
			content: fixture.content,
			confidence: 0.5,
			sourceRunId: created.id,
			version: 1,
		});
		// Confidence is management input. The model tool owns neither confidence nor source Run identity.
		const { memory: managed } = await requestAgentJson(
			request,
			{
				method: 'POST',
				path,
				status: 201,
				data: {
					content: 'Management ' + fixture.content,
					confidence: fixture.confidence,
					sourceRunId: null,
					expiresAt: null,
				},
			},
			readAgentMemoryResponse,
		);
		expect(managed.confidence).toBe(fixture.confidence);
		const reviewId = managed.id;

		const readManaged = async () =>
			(await requestAgentJson(request, { method: 'GET', path: `${path}/${reviewId}` }, readAgentMemoryResponse))
				.memory;

		const section = page.getByRole('complementary', { name: 'Memory review', exact: true });
		if (!modelCandidate) throw new Error('Model memory candidate missing');
		const row = section.locator('article').filter({ has: page.getByText(modelCandidate.content, { exact: true }) });
		await expect(section).toBeVisible();
		await expect(row).toBeVisible();
		await expect(section.getByText(managed.content, { exact: true })).toHaveCount(0);
		const endpoint = `/api/v1/agent${path}/${modelCandidate.id}/review`;
		const publishedWaiting = page.waitForResponse(
			(response) => response.url().endsWith(endpoint) && response.request().method() === 'POST',
		);
		await row.getByRole('button', { name: 'Save memory', exact: true }).click();
		const publishedResponse = await publishedWaiting;
		expect(publishedResponse.status()).toBe(200);
		expect(publishedResponse.request().postDataJSON()).toEqual({
			expectedVersion: modelCandidate.version,
			decision: 'publish',
			content: modelCandidate.content,
		});
		await expect(row).toHaveCount(0);
		const publishedModel = (
			await requestAgentJson(
				request,
				{ method: 'GET', path: `${path}/${modelCandidate.id}` },
				readAgentMemoryResponse,
			)
		).memory;
		expect(publishedModel).toMatchObject({
			id: modelCandidate.id,
			status: 'published',
			version: 2,
			confidence: 0.5,
			sourceRunId: created.id,
		});
		expect(await readManaged()).toMatchObject({
			id: reviewId,
			status: 'candidate',
			version: 1,
			confidence: fixture.confidence,
		});

		const managedEndpoint = `${path}/${reviewId}/review`;
		const published = await requestAgentJson(
			request,
			{
				method: 'POST',
				path: managedEndpoint,
				data: { expectedVersion: managed.version, decision: 'publish', content: managed.content },
			},
			readAgentMemoryResponse,
		);
		expect(published.memory).toMatchObject({
			id: reviewId,
			status: 'published',
			version: 2,
			confidence: fixture.confidence,
		});
		const stale = await requestAgentJson(
			request,
			{
				method: 'POST',
				path: managedEndpoint,
				status: 409,
				data: { expectedVersion: managed.version, decision: 'revoke', content: null },
			},
			readAgentErrorResponse,
		);
		expect(stale.code).toBe('version_conflict');
		expect(await readManaged()).toMatchObject({ id: reviewId, status: 'published', version: 2 });
		const current = await readManaged();
		const revoked = await requestAgentJson(
			request,
			{
				method: 'POST',
				path: managedEndpoint,
				data: { expectedVersion: current.version, decision: 'revoke', content: null },
			},
			readAgentMemoryResponse,
		);
		expect(revoked.memory).toMatchObject({ id: reviewId, status: 'revoked', version: 3 });
		const recallable = await requestAgentJson(
			request,
			{ method: 'GET', path: path + '?status=published&limit=20&offset=0' },
			readAgentMemoryListResponse,
		);
		expect(recallable.items.some((memory) => memory.id === reviewId)).toBe(false);
	});
}

for (const boundary of ['absolute', 'duration'] as const) {
	test(`delegation rejects invalid ${boundary} deadline without creating a child`, async ({ request, page }) => {
		// Invalid delegation arguments are rejected before creating a child;
		// the model receives the definite tool refusal and can finish its reply.
		const task = await prepareNativeTask(request, page, ['app.intents.exchange']);
		await openNativeTask(task);
		const created = await startNativeTask(task, `E2E_REGRESSION_DEADLINE_SENTINEL boundary=${boundary}`);
		const result = await finishNativeTask(task, created.id);
		expect(result.run.status).toBe('completed');
		expect(result.text).toBe('DELEGATION_REJECTED:tool_invalid_input');
		// The model response itself is complete. The rejected tool proposal
		// must not fabricate a Child or an unknown remote effect.
		const tools = await requestAgentJson(
			request,
			{ method: 'GET', path: `/apps/${task.app.id}/threads/${task.thread.id}/tools?limit=20` },
			(raw) => readAgentThreadToolsResponse(raw, task.app.id, null, 20),
		);
		expect(tools.items).toHaveLength(1);
		expect(tools.items[0]).toMatchObject({
			runId: created.id,
			toolName: 'collaboration_delegate',
			state: 'failed',
		});
		const children = await requestAgentWorkspace(request, task.app, {
			method: 'agent.subagents.list',
			params: { runId: created.id },
		});
		if (children.method !== 'agent.subagents.list') {
			throw new Error('Unexpected children');
		}
		expect(children.value.items).toEqual([]);
	});
}
