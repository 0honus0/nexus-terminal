import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test as protocolTest, useHttpProtocol } from './protocol-fixture.mjs';
import { openControlledSsh } from '../protocols/controlled-ssh-fixture.mjs';

export { expect, loginAsAdmin, HTTP_TEST_ORIGIN } from './protocol-fixture.mjs';

export const test = protocolTest.extend({
	ssh: async ({}, use) => {
		const directory = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'controlled-ssh-'));
		const ssh = await openControlledSsh(directory);
		try {
			await use(ssh);
		} finally {
			await ssh.close();
		}
	},

	// Dependency order keeps the peer alive until the real application has drained.
	httpClients: async ({ ssh }, use) => {
		await useHttpProtocol(use);
	},
});
