import { test, expect, vi } from 'vitest';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';
import { connectionsApi } from '../../../../packages/frontend/src/features/connections/api/connections-api.ts';
import { useConnectionsStore } from '../../../../packages/frontend/src/features/connections/store/connections.store.ts';
import { tagsApi } from '../../../../packages/frontend/src/features/tags/api/tags-api.ts';
import { TargetRequestFailure } from '../../../../packages/frontend/src/client/targets/target-types.ts';

test('real connections preserve atomic credentials, clone identity, rollback, CAS and lost receipts', async () => {
	const { application } = await openAuthenticatedFrontendApplication();
	const original = application.fetch;
	const connections = useConnectionsStore();
	const checks = [];

	const check = (value, name) => {
		expect(value, name).toBeTruthy();
		checks.push(name);
	};

	const input = (name) => ({
		name,
		type: 'SSH',
		host: '127.0.0.1',
		port: 22,
		username: 'user',
		route: 'direct',
		proxyId: null,
		notes: null,
		tagIds: [],
		jumpIds: [],
	});

	async function failure(work, code) {
		const cause = await work().catch((cause) => cause);
		expect(cause).toBeInstanceOf(TargetRequestFailure);
		expect(cause.code).toBe(code);
	}

	await connections.load(true);
	const imported = await connections.create({
		connection: input('connection atomic'),
		credential: { kind: 'password', password: '  connection secret  ' },
		tagNames: ['atomic connection tag'],
	});
	check(imported[0].status === 'ok', 'real atomic connection/credential/tag creation');
	await connections.load(true);
	let item = await connectionsApi.get(imported[0].id);
	let state = await connectionsApi.credential(item.id);
	check(
		item.tagIds.length === 1 &&
			state.version === item.version &&
			state.credential.kind === 'password' &&
			Object.keys(state.credential).length === 1,
		'real safe credential summary shares metadata version without secrets',
	);
	const changed = await connections.update(item, { notes: 'metadata only' });
	check(
		(await connectionsApi.credential(item.id)).credential.kind === 'password',
		'real metadata save preserves credential',
	);
	await failure(() => connections.update(item, { notes: 'stale' }), 'version_conflict');
	check(connections.needsRefresh, 'connection conflict requires read recovery');
	await connections.load(true);
	await connections.setCredential(changed, null);
	state = await connectionsApi.credential(item.id);
	check(
		state.credential.kind === 'none' && state.version === changed.version + 1,
		'real explicit credential clear advances metadata CAS',
	);
	await connections.load(true);
	const cloned = await connections.clone(item.id, 'connection clone');
	check(
		cloned.id !== item.id &&
			cloned.version === 1 &&
			(await connectionsApi.credential(cloned.id)).credential.kind === 'none',
		'real clone uses independent identity and credential state',
	);
	await failure(() => connectionsApi.credential(Number.MAX_SAFE_INTEGER), 'not_found');
	check(true, 'real missing credential resource returns not_found');
	const rejected = await connections.importMany([
		{
			connection: input('failed atomic'),
			credential: { kind: 'ssh_key', sshKeyId: Number.MAX_SAFE_INTEGER },
			tagNames: ['must rollback'],
		},
	]);
	await connections.load(true);
	check(
		rejected[0].status === 'error' &&
			!connections.items.some((row) => row.name === 'failed atomic') &&
			!(await tagsApi.list()).some((row) => row.name === 'must rollback'),
		'real import failure rolls back metadata and new tags',
	);
	const credentialOriginal = await connectionsApi.get(item.id);
	let credentialWrites = 0;
	vi.stubGlobal('fetch', async (url, options) => {
		if (String(url).endsWith(`/${item.id}/credential`) && options?.method === 'PUT') {
			credentialWrites++;
			const committed = await original(url, options);
			if (committed.status !== 200) throw Error('Credential fixture did not commit');
			await committed.arrayBuffer();
			throw new TypeError('lost credential acknowledgement');
		}
		return original(url, options);
	});
	await failure(
		() =>
			connections.setCredential(credentialOriginal, {
				kind: 'password',
				password: 'retained unknown',
			}),
		'request_failed',
	);
	await failure(() => connections.setCredential(credentialOriginal, null), 'recovery_required');
	check(credentialWrites === 1, 'committed credential acknowledgement loss prevents write replay');
	vi.stubGlobal('fetch', original);
	await connections.load(true);
	check(
		(await connectionsApi.credential(item.id)).version === credentialOriginal.version + 1,
		'real credential read recovers committed unknown without replay',
	);

	expect(checks).toHaveLength(10);
});
