// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { requestNativeWorkspace } from '../../../../packages/frontend/src/features/agent/api/native-workspace-request';
import { AgentManagementFailure } from '../../../../packages/frontend/src/features/agent/model/management-failure';
import { readAgentWorkspaceRequest } from '../../../../packages/shared/src/agent/scope/workspace-http-codec';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('native event client rejects duplicate pages and retains the supplied cursor after failure', async () => {
	const appId = randomUUID();
	const runId = randomUUID();
	const afterValues: number[] = [];
	let malformed = false;
	server.use(
		http.post('*/api/v1/agent/apps/:appId/workspace', async ({ request }) => {
			const body = readAgentWorkspaceRequest(await request.json());
			expect(body.request.method).toBe('agent.runs.events');
			if (body.request.method !== 'agent.runs.events') throw new Error('Unexpected event request');
			afterValues.push(body.request.params.after);
			const event = { runId, sequence: 8, type: 'run.completed', runVersion: 3, createdAt: Date.now() };
			return HttpResponse.json({
				appId,
				appVersion: 1,
				result: {
					method: 'agent.runs.events',
					value: {
						items: malformed ? [event, event] : [event],
						nextCursor: 8,
					},
				},
			});
		}),
	);

	const read = () =>
		requestNativeWorkspace(
			{ appId, appVersion: 1 },
			{
				appVersion: 1,
				request: { method: 'agent.runs.events', params: { runId, after: 7, limit: 100 } },
			},
		);

	const reply = await read();
	expect(reply.method).toBe('agent.runs.events');
	if (reply.method !== 'agent.runs.events') throw new Error('Unexpected event response');
	expect(reply.value.nextCursor).toBe(8);
	expect(reply.value.items[0]?.runId).toBe(runId);
	malformed = true;
	await expect(read()).rejects.toSatisfy(
		(cause: unknown) =>
			cause instanceof AgentManagementFailure && cause.code === 'protocol_failure' && cause.outcome === 'unknown',
	);
	expect(afterValues).toEqual([7, 7]);
});
