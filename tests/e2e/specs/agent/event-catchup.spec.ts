import { randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { prepareAgentRun, requestAgentWorkspace } from '../../support/agent';
import { AGENT_RUN_EVENT_TYPES } from '../../../../packages/shared/src/agent/runs/values';
import { E2E_URLS } from '../../support/test-env';

test('native Run events catch up from the server cursor and preserve the original creation result', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const { app, thread, input } = await prepareAgentRun(request);
	const command = {
		method: 'agent.runs.create',
		params: { threadId: thread.id, operationId: randomUUID(), input },
	} as const;
	const created = await requestAgentWorkspace(request, app, command);
	if (created.method !== 'agent.runs.create') throw new Error('Unexpected Run confirmation');
	expect(created.value.status).toBe('created');
	const initial = created.value.run;
	await expect
		.poll(async () => {
			const result = await requestAgentWorkspace(request, app, {
				method: 'agent.runs.get',
				params: { runId: initial.id },
			});
			return result.method === 'agent.runs.get' ? result.value?.status : null;
		})
		.toBe('completed');

	const events = [];
	let cursor = 0;
	for (let page = 0; page < 10; page++) {
		const result = await requestAgentWorkspace(request, app, {
			method: 'agent.runs.events',
			params: { runId: initial.id, after: cursor, limit: 1 },
		});
		if (result.method !== 'agent.runs.events') throw new Error('Unexpected event page');
		if (result.value.items.length === 0) {
			expect(result.value.nextCursor).toBe(cursor);
			break;
		}
		expect(result.value.items).toHaveLength(1);
		const event = result.value.items[0];
		expect(event.runId).toBe(initial.id);
		expect(event.sequence).toBeGreaterThan(cursor);
		expect(AGENT_RUN_EVENT_TYPES).toContain(event.type);
		expect(result.value.nextCursor).toBe(event.sequence);
		events.push(event);
		cursor = result.value.nextCursor;
	}
	expect(events.map((item) => item.type)).toEqual(['run.created', 'run.started', 'run.completed']);
	expect(new Set(events.map((item) => item.sequence)).size).toBe(events.length);

	const replay = await requestAgentWorkspace(request, app, command);
	if (replay.method !== 'agent.runs.create') throw new Error('Unexpected replay confirmation');
	expect(replay.value).toEqual({ status: 'replayed', originalStatus: 'created', run: initial });
	const afterReplay = await requestAgentWorkspace(request, app, {
		method: 'agent.runs.events',
		params: { runId: initial.id, after: cursor, limit: 1 },
	});
	if (afterReplay.method !== 'agent.runs.events') throw new Error('Unexpected replay event page');
	expect(afterReplay.value).toEqual({ items: [], nextCursor: cursor });
});

test('native event pages reject invalid cursors and do not leak events to another App or a logged-out session', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const { app, thread, input } = await prepareAgentRun(request);
	const result = await requestAgentWorkspace(request, app, {
		method: 'agent.runs.create',
		params: { threadId: thread.id, operationId: randomUUID(), input },
	});
	if (result.method !== 'agent.runs.create') throw new Error('Unexpected Run confirmation');
	const path = '/api/v1/agent/apps/' + app.id + '/runs/' + result.value.run.id + '/events';
	for (const query of ['after=-1', 'after=01', 'after=0&after=0', 'limit=0', 'limit=101', 'cursor=0']) {
		const rejected = await request.get(path + '?' + query);
		expect(rejected.status()).toBe(400);
		await expect(rejected.json()).resolves.toEqual({ code: 'invalid_input' });
	}
	const other = await request.get('/api/v1/agent/apps/' + randomUUID() + '/runs/' + result.value.run.id + '/events');
	expect(other.status()).toBe(404);
	await expect(other.json()).resolves.toEqual({ code: 'not_found' });
	const logout = await request.post('/api/v1/auth/logout', { headers: { Origin: E2E_URLS.frontendOrigin } });
	expect(logout.ok()).toBeTruthy();
	const denied = await request.get(path + '?after=0&limit=1');
	expect(denied.status()).toBe(401);
	await expect(denied.json()).resolves.toEqual({ code: 'unauthenticated' });
});

// Browser transport tests use the real production client, not the removed WS subscription module.
test('production native event client rejects duplicate pages and retains its supplied cursor', async ({ page }) => {
	const appId = randomUUID();
	const runId = randomUUID();
	const afterValues: number[] = [];
	let malformed = false;
	await page.route('**/api/v1/agent/apps/*/workspace', async (route) => {
		const body = route.request().postDataJSON();
		expect(body.request.method).toBe('agent.runs.events');
		afterValues.push(body.request.params.after);
		const event = { runId, sequence: 8, type: 'run.completed', runVersion: 3, createdAt: Date.now() };
		await route.fulfill({
			json: {
				appId,
				appVersion: 1,
				result: {
					method: 'agent.runs.events',
					value: { items: malformed ? [event, event] : [event], nextCursor: 8 },
				},
			},
		});
	});
	await page.goto('/login');

	const read = () =>
		page.evaluate(
			async ({ appId, runId }) => {
				const path = '/src/features/agent/api/native-run-api.ts';
				const { listNativeEvents } = await import(/* @vite-ignore */ path);
				try {
					const result = await listNativeEvents({ appId, appVersion: 1 }, runId, 7);
					return { status: 'ok', cursor: result.nextCursor, runId: result.items[0]?.runId };
				} catch (cause) {
					const failurePath = '/src/features/agent/model/management-failure.ts';
					const { AgentManagementFailure } = await import(/* @vite-ignore */ failurePath);
					if (
						!(cause instanceof AgentManagementFailure) ||
						!(cause instanceof Error) ||
						!('code' in cause) ||
						!('outcome' in cause)
					)
						throw cause;
					return { status: 'error', code: cause.code, outcome: cause.outcome };
				}
			},
			{ appId, runId },
		);

	expect(await read()).toEqual({ status: 'ok', cursor: 8, runId });
	malformed = true;
	expect(await read()).toEqual({ status: 'error', code: 'protocol_failure', outcome: 'unknown' });
	expect(afterValues).toEqual([7, 7]);
});
