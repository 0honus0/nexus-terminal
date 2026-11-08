import { test, expect, onTestFinished } from 'vitest';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';
import { openSshd } from '../../../support/protocols/openssh-fixture.mjs';
import { connectionsApi } from '../../../../packages/frontend/src/features/connections/api/connections-api.ts';
import { connectionTestApi } from '../../../../packages/frontend/src/features/connections/api/connection-test-api.ts';
import { hostKeysApi } from '../../../../packages/frontend/src/features/connections/api/host-keys-api.ts';
import { sshKeysApi } from '../../../../packages/frontend/src/features/ssh-keys/api/ssh-keys-api.ts';
import { ConnectionTestHostKeyFailure } from '../../../../packages/frontend/src/features/connections/model/connection-errors.ts';

test('saved and unsaved SSH tests use the real daemon and preserve the unknown trust challenge', async () => {
	const { application } = await openAuthenticatedFrontendApplication();
	let ssh;
	onTestFinished(async () => {
		const failures = [];
		for (const close of [() => application.close(), () => ssh?.close()]) {
			try {
				await close();
			} catch (cause) {
				failures.push(cause);
			}
		}
		if (failures.length) throw new AggregateError(failures, 'SSH connection test cleanup failed');
	});
	ssh = await openSshd(application.directory);
	const key = await sshKeysApi.create({ name: 'connection real SSH key', privateKey: ssh.privateKey });
	const result = await connectionsApi.importMany([
		{
			connection: {
				name: 'SSH test target',
				type: 'SSH',
				host: '127.0.0.1',
				port: ssh.port,
				username: ssh.user,
				route: 'direct',
				proxyId: null,
				notes: null,
				tagIds: [],
				jumpIds: [],
			},
			credential: { kind: 'ssh_key', sshKeyId: key.id },
		},
	]);
	expect(result).toHaveLength(1);
	expect(result[0].status).toBe('ok');
	const id = result[0].id;
	const failure = await connectionTestApi.saved(id).catch((cause) => cause);
	expect(failure).toBeInstanceOf(ConnectionTestHostKeyFailure);
	expect(failure.code).toBe('host_key_untrusted');
	expect(failure.hostKey).toEqual({
		host: '127.0.0.1',
		port: ssh.port,
		fingerprint: ssh.fingerprint,
		expectedFingerprint: null,
	});
	await hostKeysApi.confirm({ host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint });
	expect(Number.isFinite(await connectionTestApi.saved(id))).toBe(true);
	const before = await connectionsApi.list();
	expect(
		Number.isFinite(
			await connectionTestApi.unsaved({
				host: '127.0.0.1',
				port: ssh.port,
				username: ssh.user,
				authentication: { kind: 'ssh_key', sshKeyId: key.id },
				route: 'direct',
				proxyId: null,
				jumpIds: [],
			}),
		),
	).toBe(true);
	expect(await connectionsApi.list()).toEqual(before);
});
