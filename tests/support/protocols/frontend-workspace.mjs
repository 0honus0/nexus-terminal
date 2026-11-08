import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { vi, onTestFinished } from 'vitest';
import { openFrontendApplication } from '../http/frontend-application.mjs';
import { openSshd } from './openssh-fixture.mjs';

/** Real client → HTTP/WS → application → OpenSSH; browser-only behavior stays in Playwright. */
export async function openWorkspaceApplication() {
	const application = await openFrontendApplication();
	let ssh;
	let closing;

	const close = () =>
		(closing ??= Promise.resolve().then(async () => {
			const failures = [];
			for (const stop of [() => application.close(), () => ssh?.close()]) {
				try {
					await stop();
				} catch (cause) {
					failures.push(cause);
				}
			}
			if (failures.length) throw new AggregateError(failures, 'Workspace application cleanup failed');
		}));

	onTestFinished(close);

	try {
		const directory = application.directory;
		const root = join(directory, 'files');
		await mkdir(root);
		ssh = await openSshd(directory);
		setActivePinia(createPinia());
		vi.stubGlobal('fetch', application.fetch);
		vi.stubGlobal('ArrayBuffer', Buffer.alloc(0).buffer.constructor);
		const { createAccessApi } = await import('../../../packages/frontend/src/features/auth/api/access-api.ts');
		const { useAuthStore } = await import('../../../packages/frontend/src/features/auth/store/auth.store.ts');
		const { hostKeysApi } =
			await import('../../../packages/frontend/src/features/connections/api/host-keys-api.ts');
		const { sshKeysApi } = await import('../../../packages/frontend/src/features/ssh-keys/api/ssh-keys-api.ts');
		const { connectionsApi } =
			await import('../../../packages/frontend/src/features/connections/api/connections-api.ts');
		const password = 'c2-isolated-password-123';
		await createAccessApi().setup({ username: 'admin', password, confirmPassword: password });
		await useAuthStore().login({ username: 'admin', password });
		await hostKeysApi.confirm({ host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint });
		const key = await sshKeysApi.create({ name: 'Workspace test key', privateKey: ssh.privateKey });
		const imported = await connectionsApi.importMany([
			{
				connection: {
					name: 'Workspace SSH',
					type: 'SSH',
					host: '127.0.0.1',
					port: ssh.port,
					username: ssh.user,
					route: 'direct',
					proxyId: null,
					tagIds: [],
					jumpIds: [],
					notes: null,
				},
				credential: { kind: 'ssh_key', sshKeyId: key.id },
			},
		]);
		assert.equal(imported[0].status, 'ok');
		const target = await connectionsApi.get(imported[0].id);
		vi.stubGlobal('WebSocket', await application.webSocket());
		return { application, ssh, directory, root, target, key, close };
	} catch (cause) {
		try {
			await close();
		} catch (cleanup) {
			throw new AggregateError([cause, cleanup], 'Workspace setup and cleanup failed');
		}
		throw cause;
	}
}
