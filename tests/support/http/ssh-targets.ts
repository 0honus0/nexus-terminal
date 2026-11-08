import assert from 'node:assert/strict';
import type { APIRequestContext } from '@playwright/test';
import type { ControlledSsh } from '../protocols/controlled-ssh-fixture.mjs';
import type { TargetCredentialInput } from '../../../packages/shared/src/targets/connections/http';
import {
	readConnectionView,
	readCredentialMutation,
} from '../../../packages/shared/src/targets/connections/http-codec';

export async function trustSshHostKey(request: APIRequestContext, ssh: ControlledSsh, port = ssh.port): Promise<void> {
	const confirmed = await request.post('/api/v1/targets/host-keys/confirm', {
		data: { host: ssh.host, port, fingerprint: ssh.fingerprint },
	});
	assert.equal(confirmed.status(), 201);
}

/** Establish real target trust and credentials through the installed HTTP boundaries. */
export async function createSshConnection(
	request: APIRequestContext,
	ssh: ControlledSsh,
	name = 'Isolated SSH',
	port = ssh.port,
	credential: TargetCredentialInput = { kind: 'password', password: ssh.password },
): Promise<number> {
	await trustSshHostKey(request, ssh, port);
	const created = await request.post('/api/v1/targets/connections', {
		data: {
			name,
			type: 'SSH',
			host: ssh.host,
			port,
			username: ssh.username,
			route: 'direct',
			proxyId: null,
			notes: null,
			tagIds: [],
			jumpIds: [],
		},
	});
	assert.equal(created.status(), 201);
	const connection = readConnectionView(await created.json());
	const saved = await request.put('/api/v1/targets/connections/' + connection.id + '/credential', {
		data: { version: connection.version, credential },
	});
	assert.equal(saved.status(), 200);
	assert.deepEqual(readCredentialMutation(await saved.json()), { status: 'updated' });
	return connection.id;
}
