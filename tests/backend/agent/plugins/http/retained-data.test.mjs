import { test, expect, requestAgentJson } from '../../../../support/http/plugin-protocol-fixture.mjs';
import { readAgentAppListResponse } from '../../../../../packages/shared/src/agent/scope/http-codec';
import {
	readAgentPluginInstallationList,
	readAgentPluginInstallation,
	readAgentPluginDataView,
	readAgentPluginDataPurgeView,
} from '../../../../../packages/shared/src/agent/plugins/http-codec';
import { agentRecord, readAgentErrorResponse } from '../../../../../packages/shared/src/agent/http-codec';
test('uninstalled plugin retained AppStorage can be permanently deleted', async ({ pluginHost }) => {
	const installed = await pluginHost.install('retained-data');
	const installation = installed.installation;
	const request = pluginHost.api;
	const app = { id: installed.appId };
	const path = `/plugins/installations/${app.id}`;
	const stored = await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: path + '/data/e2e.retained',
			data: {
				expectedRevision: installation.revision,
				expectedVersion: 0,
				operationId: randomUUID(),
				valueJson: JSON.stringify({ retained: true }),
			},
		},
		readAgentPluginDataView,
	);
	expect(JSON.parse(stored.valueJson)).toEqual({ retained: true });
	const fetched = await requestAgentJson(request, { method: 'GET', path: path + '/data/e2e.retained' }, (raw) => {
		const row = agentRecord(raw, ['value']);
		return row.value === null ? null : readAgentPluginDataView(row.value);
	});
	expect(fetched).toEqual(stored);
	const removed = await requestAgentJson(
		request,
		{
			method: 'DELETE',
			path,
			data: { expectedRevision: installation.revision },
		},
		readAgentPluginInstallation,
	);
	expect(removed.status).toBe('removed');
	const apps = await requestAgentJson(request, { method: 'GET', path: '/apps' }, readAgentAppListResponse);
	expect(apps.some((item) => item.id === app.id)).toBe(false);
	const retained = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/installations' },
		readAgentPluginInstallationList,
	);
	expect(retained.items).toContainEqual(removed);
	expect(retained.retainedAppIds).toContain(app.id);
	const purge = { expectedRevision: removed.revision, operationId: randomUUID() };
	const deleted = await requestAgentJson(
		request,
		{ method: 'POST', path: path + '/delete-data', data: purge },
		readAgentPluginDataPurgeView,
	);
	expect(deleted.deletedKeys).toBe(1);
	expect(deleted.revision).toBe(removed.revision + 1);
	const cleared = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/installations' },
		readAgentPluginInstallationList,
	);
	expect(cleared.retainedAppIds).not.toContain(app.id);
	const replay = await requestAgentJson(
		request,
		{ method: 'POST', path: path + '/delete-data', data: purge },
		readAgentPluginDataPurgeView,
	);
	expect(replay).toEqual(deleted);
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: path + '/delete-data',
			status: 409,
			data: { expectedRevision: removed.revision, operationId: randomUUID() },
		},
		(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'version_conflict' }),
	);
	const empty = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: path + '/delete-data',
			data: { expectedRevision: deleted.revision, operationId: randomUUID() },
		},
		readAgentPluginDataPurgeView,
	);
	expect(empty.deletedKeys).toBe(0);
});
import { randomUUID } from 'node:crypto';
