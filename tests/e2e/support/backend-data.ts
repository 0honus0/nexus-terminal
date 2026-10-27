import fs from 'node:fs/promises';
import path from 'node:path';
import { readSuspendedSessionId } from '../../../packages/shared/src/remote/suspend/http-codec';

/** Resolve the isolated server instance; never create a parallel legacy log tree. */
export async function suspendedLogFile(suspendedSessionId: string): Promise<string> {
	const id = readSuspendedSessionId(suspendedSessionId);
	const root = path.resolve(__dirname, '../.tmp/backend-data');
	const directories = (await fs.readdir(root, { withFileTypes: true })).filter(
		(entry) => entry.isDirectory() && entry.name.startsWith('backend-'),
	);
	if (directories.length !== 1) {
		throw new Error('Expected one isolated backend data directory');
	}
	return path.join(root, directories[0].name, 'temp_backend_next_suspended_ssh_logs', id + '.log');
}
