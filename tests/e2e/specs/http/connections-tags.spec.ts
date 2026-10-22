import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, createTestSshConnection, trustTestSshHostKey } from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession } from '../../support/ws';
import { E2E_URLS } from '../../support/test-env';
import { step } from '../../support/steps';
import {
	readConnectionView,
	readConnectionMutation,
} from '../../../../packages/shared/src/targets/connections/http-codec';
import { readConnectionTestResponse } from '../../../../packages/shared/src/targets/connections/test-codec';
import { readTagView, readTagConnectionsResponse } from '../../../../packages/shared/src/targets/tags/http-codec';
import {
	readSshResourceStatus,
	readSshResourceStatusList,
} from '../../../../packages/shared/src/remote/monitoring/http-codec';
import { readSettingsResponse } from '../../../../packages/shared/src/preferences/configuration/http-codec';

const headers = { Origin: E2E_URLS.frontendOrigin };
const root = '/api/v1/targets';

test('connection update, tags, clone, credentials, and delete form a complete lifecycle', async ({ request }) => {
	await loginAsInitialAdmin(request);
	await trustTestSshHostKey(request);
	const tagResponse = await request.post(root + '/tags', { headers, data: { name: 'E2E Connection Tag' } });
	expect(tagResponse.status()).toBe(201);
	const tag = readTagView(await tagResponse.json());
	const connectionId = await createTestSshConnection(request, 'E2E Lifecycle SSH');
	let cloneId: number | null = null;
	let originalDeleted = false;
	try {
		await step('assign a tag and update metadata without losing the stored password', async () => {
			const assigned = await request.post(root + '/connections/add-tag', {
				headers,
				data: { connectionIds: [connectionId], tagId: tag.id },
			});
			expect(assigned.ok()).toBe(true);
			expect(readTagConnectionsResponse(await assigned.json())).toEqual({ updated: true });
			const current = await request.get(root + '/connections/' + connectionId);
			expect(current.ok()).toBe(true);
			const connection = readConnectionView(await current.json());
			expect(connection.tagIds).toContain(tag.id);
			const updated = await request.put(root + '/connections/' + connectionId, {
				headers,
				data: {
					version: connection.version,
					changes: { name: 'E2E Lifecycle SSH Updated', notes: 'updated without resending password' },
				},
			});
			expect(updated.ok()).toBe(true);
			expect(readConnectionMutation(await updated.json())).toMatchObject({
				status: 'updated',
				value: {
					id: connectionId,
					name: 'E2E Lifecycle SSH Updated',
					notes: 'updated without resending password',
					version: connection.version + 1,
				},
			});
			const tested = await request.post(root + '/connections/' + connectionId + '/test', { headers });
			expect(tested.ok()).toBe(true);
			expect(readConnectionTestResponse(await tested.json()).status).toBe('ok');
		});
		await step('clone preserves credentials and tag associations', async () => {
			const response = await request.post(root + '/connections/' + connectionId + '/clone', {
				headers,
				data: { name: 'E2E Lifecycle SSH Clone' },
			});
			expect(response.status()).toBe(201);
			const clone = readConnectionView(await response.json());
			cloneId = clone.id;
			expect(clone.id).not.toBe(connectionId);
			expect(clone.tagIds).toContain(tag.id);
			const tested = await request.post(root + '/connections/' + clone.id + '/test', { headers });
			expect(tested.ok()).toBe(true);
			expect(readConnectionTestResponse(await tested.json()).status).toBe('ok');
		});
		await step('deleting the original leaves the clone readable and usable', async () => {
			expect((await request.delete(root + '/connections/' + connectionId, { headers })).ok()).toBe(true);
			originalDeleted = true;
			expect((await request.get(root + '/connections/' + connectionId)).status()).toBe(404);
			const response = await request.get(root + '/connections/' + cloneId);
			expect(response.ok()).toBe(true);
			expect(readConnectionView(await response.json())).toMatchObject({
				id: cloneId,
				name: 'E2E Lifecycle SSH Clone',
			});
			expect((await request.post(root + '/connections/' + cloneId + '/test', { headers })).ok()).toBe(true);
		});
	} finally {
		const cleanup = await Promise.allSettled([
			...(originalDeleted
				? []
				: [
						request
							.delete(root + '/connections/' + connectionId, { headers })
							.then((response) => expect(response.ok()).toBe(true)),
					]),
			...(cloneId === null
				? []
				: [
						request
							.delete(root + '/connections/' + cloneId, { headers })
							.then((response) => expect(response.ok()).toBe(true)),
					]),
		]);
		const tagCleanup = await request.delete(root + '/tags/' + tag.id, { headers });
		expect(tagCleanup.ok()).toBe(true);
		const failures = cleanup.filter((result) => result.status === 'rejected');
		if (failures.length)
			throw new AggregateError(
				failures.map((result) => result.reason),
				'Connection cleanup failed',
			);
	}
});

test('new SSH connections appear in resource status immediately', async ({ request }) => {
	await loginAsInitialAdmin(request);
	await trustTestSshHostKey(request);
	const primed = await request.get('/api/v1/system/ssh-resources');
	expect(primed.ok()).toBe(true);
	expect(
		readSshResourceStatusList(await primed.json()).some(
			(resource) => resource.host === E2E_SSH.host && resource.port === E2E_SSH.port,
		),
	).toBe(false);
	const id = await createTestSshConnection(request, 'E2E SSH Resource Cache Invalidation');
	try {
		const response = await request.get('/api/v1/system/ssh-resources');
		expect(response.ok()).toBe(true);
		const resource = readSshResourceStatusList(await response.json()).find((item) => item.connectionId === id);
		expect(resource).toBeDefined();
		expect(resource?.status?.cpuPercent).toBeGreaterThanOrEqual(0);
		const individual = await request.get('/api/v1/system/ssh-resources/' + id);
		expect(individual.ok()).toBe(true);
		expect(readSshResourceStatus(await individual.json())).toEqual(resource);
	} finally {
		expect((await request.delete(root + '/connections/' + id, { headers })).ok()).toBe(true);
	}
});

test('background resource collection leaves metadata unchanged while Workspace reports user connection time', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	await trustTestSshHostKey(request);
	const id = await createTestSshConnection(request, 'E2E SSH Resource Does Not Touch Metadata');
	try {
		const before = await request.get(root + '/connections/' + id);
		expect(before.ok()).toBe(true);
		const original = readConnectionView(await before.json());
		const resources = await request.get('/api/v1/system/ssh-resources');
		expect(resources.ok()).toBe(true);
		expect(
			readSshResourceStatusList(await resources.json()).some(
				(row) => row.connectionId === id && row.status !== undefined,
			),
		).toBe(true);
		const after = await request.get(root + '/connections/' + id);
		expect(after.ok()).toBe(true);
		expect(readConnectionView(await after.json())).toEqual(original);
		const workspace = await openWorkspaceSession(request, id);
		try {
			expect(workspace.lastConnectedAt).toBeGreaterThan(0);
			const connectedResponse = await request.get(root + '/connections/' + id);
			expect(connectedResponse.ok()).toBe(true);
			const connected = readConnectionView(await connectedResponse.json());
			expect(connected.lastConnectedAt).toBeGreaterThan(0);
			expect(connected.version).toBe(original.version);
			expect(connected.updatedAt).toBe(original.updatedAt);
		} finally {
			await closeWebSocket(workspace.socket);
		}
	} finally {
		expect((await request.delete(root + '/connections/' + id, { headers })).ok()).toBe(true);
	}
});

test('SSH resource cache expires at the effective startup cadence including collection time', async ({ request }) => {
	test.setTimeout(150_000);
	await loginAsInitialAdmin(request);
	await trustTestSshHostKey(request);
	const settings = await request.get('/api/v1/settings');
	expect(settings.ok()).toBe(true);
	const intervalMs =
		readSettingsResponse(await settings.json()).effectiveMonitoring.remoteHostRefreshIntervalSeconds * 1000;
	const id = await createTestSshConnection(request, 'E2E SSH Resource Refresh Cadence');
	try {
		const startedAt = Date.now();
		const firstResponse = await request.get('/api/v1/system/ssh-resources/' + id);
		expect(firstResponse.ok()).toBe(true);
		const first = readSshResourceStatus(await firstResponse.json());
		expect(first.status).toBeDefined();
		expect(Date.now() - startedAt).toBeGreaterThan(50);
		await new Promise((resolve) =>
			setTimeout(resolve, Math.max(0, first.checkedAt + intervalMs + 100 - Date.now())),
		);
		const secondResponse = await request.get('/api/v1/system/ssh-resources/' + id);
		expect(secondResponse.ok()).toBe(true);
		const second = readSshResourceStatus(await secondResponse.json());
		expect(second.status).toBeDefined();
		expect(second.checkedAt).toBeGreaterThan(first.checkedAt);
	} finally {
		expect((await request.delete(root + '/connections/' + id, { headers })).ok()).toBe(true);
	}
});
