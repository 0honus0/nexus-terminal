import { randomUUID } from 'node:crypto';
import {
	test,
	expect,
	requestAgentJson,
	createAgentApp,
	requestAgentWorkspace,
	enableAgent,
} from '../../../../support/http/plugin-protocol-fixture.mjs';
import {
	readAgentMemoryListResponse,
	readAgentMemoryResponse,
} from '../../../../../packages/shared/src/agent/memory/http-codec';
import { readAgentErrorResponse } from '../../../../../packages/shared/src/agent/http-codec';
test('Memory proposal, review, list, stale-CAS rejection, and revoke close the public lifecycle', async ({
	pluginHost,
}) => {
	const request = pluginHost.api;
	await enableAgent(request);
	const app = await createAgentApp(pluginHost);
	const path = `/apps/${app.id}/memories`;
	const { memory: proposed } = await requestAgentJson(
		request,
		{
			method: 'POST',
			path,
			status: 201,
			data: {
				content: 'E2E candidate memory',
				confidence: 0.9,
				expiresAt: null,
				sourceRunId: null,
			},
		},
		readAgentMemoryResponse,
	);
	expect(proposed).toMatchObject({
		appId: app.id,
		content: 'E2E candidate memory',
		status: 'candidate',
		confidence: 0.9,
		version: 1,
	});
	const candidates = await requestAgentJson(
		request,
		{ method: 'GET', path: path + '?status=candidate&limit=20&offset=0' },
		readAgentMemoryListResponse,
	);
	expect(candidates.items).toContainEqual(proposed);
	const thread = await requestAgentWorkspace(request, app, {
		method: 'agent.threads.create',
		params: { autoTitle: false, operationId: randomUUID(), title: 'Memory review scope' },
	});
	if (thread.method !== 'agent.threads.create') throw new Error('Unexpected thread confirmation');
	const scoped = await requestAgentJson(
		request,
		{ method: 'GET', path: path + '?status=candidate&limit=50&offset=0&threadId=' + thread.value.id },
		readAgentMemoryListResponse,
	);
	expect(scoped.items).toEqual([]);
	expect(scoped.nextOffset).toBeNull();
	const missingThread = await requestAgentJson(
		request,
		{ method: 'GET', path: path + '?threadId=' + randomUUID(), status: 404 },
		readAgentErrorResponse,
	);
	expect(missingThread.code).toBe('not_found');
	for (const query of ['threadId=invalid', 'threadId=' + thread.value.id + '&threadId=' + thread.value.id]) {
		const invalidThread = await requestAgentJson(
			request,
			{ method: 'GET', path: path + '?' + query, status: 400 },
			readAgentErrorResponse,
		);
		expect(invalidThread.code).toBe('invalid_input');
	}
	const { memory: published } = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: `${path}/${proposed.id}/review`,
			data: {
				decision: 'publish',
				expectedVersion: proposed.version,
				content: 'E2E published memory',
			},
		},
		readAgentMemoryResponse,
	);
	expect(published).toMatchObject({
		id: proposed.id,
		content: 'E2E published memory',
		status: 'published',
		version: proposed.version + 1,
	});
	const stale = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: `${path}/${proposed.id}/review`,
			status: 409,
			data: {
				decision: 'revoke',
				expectedVersion: proposed.version,
				content: null,
			},
		},
		readAgentErrorResponse,
	);
	expect(stale.code).toBe('version_conflict');
	const publishedList = await requestAgentJson(
		request,
		{ method: 'GET', path: path + '?status=published&limit=20&offset=0' },
		readAgentMemoryListResponse,
	);
	expect(publishedList.items).toContainEqual(published);
	const { memory: revoked } = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: `${path}/${proposed.id}/review`,
			data: {
				decision: 'revoke',
				expectedVersion: published.version,
				content: null,
			},
		},
		readAgentMemoryResponse,
	);
	expect(revoked).toMatchObject({ id: proposed.id, status: 'revoked', version: published.version + 1 });
	const revokedList = await requestAgentJson(
		request,
		{ method: 'GET', path: path + '?status=revoked&limit=20&offset=0' },
		readAgentMemoryListResponse,
	);
	expect(revokedList.items).toContainEqual(revoked);
});
