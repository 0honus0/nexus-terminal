import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceRoot = process.env.NEXUS_E2E_SERVICE_ROOT;
if (!serviceRoot) {
	throw new Error('Playwright must allocate NEXUS_E2E_SERVICE_ROOT before loading tests');
}

/** Same physical namespace used by the controlled SSH service for this run. */
export const controlledSshRoot = path.join(serviceRoot, 'ssh-root');

export const acpProcessFixture = fileURLToPath(new URL('../../support/protocols/acp-process.mjs', import.meta.url));
