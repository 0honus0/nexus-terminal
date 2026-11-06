import { readdirSync } from 'node:fs';
import path from 'node:path';
import { readSuspendedSessionId } from '../../../packages/shared/src/remote/suspend/http-codec';

/** Resolve only this run's isolated server instance, leaving earlier evidence untouched. */
export function backendDataDirectory(): string {
	const configured = process.env.NEXUS_E2E_DATA_ROOT;
	if (!configured) throw new Error('NEXUS_E2E_DATA_ROOT is required');
	const root = path.resolve(configured);
	const directories = readdirSync(root, { withFileTypes: true }).filter(
		(entry) => entry.isDirectory() && entry.name.startsWith('backend-'),
	);
	if (directories.length !== 1) {
		throw new Error('Expected one isolated backend data directory');
	}
	return path.join(root, directories[0].name);
}

/** Resolve the isolated server instance; never create a parallel legacy log tree. */
export async function suspendedLogFile(suspendedSessionId: string): Promise<string> {
	const id = readSuspendedSessionId(suspendedSessionId);
	return path.join(backendDataDirectory(), 'temp_backend_next_suspended_ssh_logs', id + '.log');
}
