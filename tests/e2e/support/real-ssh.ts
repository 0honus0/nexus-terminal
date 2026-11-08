import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect } from './fixtures';
import { loginAsInitialAdmin, updateUiPreferences } from './auth';
import { restartTestBackend } from './settings';
import { E2E_URLS } from '../../support/protocols/test-environment';
import { openSshd } from '../../support/protocols/openssh-fixture.mjs';
import { readSshKeyView } from '../../../packages/shared/src/targets/ssh-keys/http-codec';
import { readConnectionImportResponse } from '../../../packages/shared/src/targets/connections/http-codec';

interface RealSshWorkspace {
	directory: string;
	targetId: number;
}

/** Independent native SSH/SFTP, with actual HTTP trust and atomic credential installation. */
export const test = base.extend<{ realSsh: RealSshWorkspace }>({
	realSsh: async ({ page, context }, use) => {
		const root = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
		await mkdir(root, { recursive: true });
		const directory = await mkdtemp(join(root, 'workspace-files-'));
		const ssh = await openSshd(directory);
		try {
			await loginAsInitialAdmin(context.request);
			await updateUiPreferences(context.request, (preferences) => {
				preferences.language = 'en-US';
				preferences.showPopupFileManager = false;
				preferences.showPopupFileEditor = true;
				preferences.fileManagerShowDeleteConfirmation = true;
			});
			const headers = { Origin: E2E_URLS.frontendOrigin };
			const trust = await context.request.post('/api/v1/targets/host-keys/confirm', {
				headers,
				data: { host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint },
			});
			expect(trust.status()).toBe(201);
			const keyResponse = await context.request.post('/api/v1/targets/ssh-keys', {
				headers,
				data: { name: 'Workspace file key', privateKey: ssh.privateKey },
			});
			expect(keyResponse.status()).toBe(201);
			const key = readSshKeyView(await keyResponse.json());
			const imported = await context.request.post('/api/v1/targets/connections/import', {
				headers,
				data: {
					items: [
						{
							connection: {
								name: 'Full page SSH',
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
					],
				},
			});
			expect(imported.status()).toBe(200);
			const result = readConnectionImportResponse(await imported.json()).items[0];
			if (result.status !== 'ok') throw Error('Native SSH target installation failed');
			await use({ directory, targetId: result.id });
		} finally {
			// Stop the real application owner before terminating its SSH peer. Keep the evidence directory.
			const failures: unknown[] = [];
			for (const close of [() => page.close(), () => restartTestBackend(), () => ssh.close()]) {
				try {
					await close();
				} catch (cause) {
					failures.push(cause);
				}
			}
			if (failures.length) throw new AggregateError(failures, 'Native SSH browser fixture cleanup failed');
		}
	},
});

export { expect };
