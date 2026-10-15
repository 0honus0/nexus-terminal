import { readFile, opendir, lstat, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { ModuleRuntimeFailure } from '../module-runtime.js';

export interface ProcessIdentity {
	pid: number;
	started: string;
}

function missing(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function processIdentity(pid: number): Promise<ProcessIdentity | null> {
	if (process.platform !== 'linux') {
		throw new ModuleRuntimeFailure('unavailable');
	}
	try {
		const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
		const end = stat.lastIndexOf(')');
		const fields = stat.slice(end + 2).split(' ');
		if (fields[0] === 'Z' || fields[0] === 'X') {
			return null;
		}
		const started = fields[19];
		if (end < 0 || !started || !/^\d+$/u.test(started)) {
			throw new ModuleRuntimeFailure('unavailable');
		}
		return { pid, started };
	} catch (error) {
		if (missing(error)) {
			return null;
		}
		throw error;
	}
}

function readIdentity(value: unknown): ProcessIdentity {
	if (
		value === null ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('pid' in value) ||
		!('started' in value) ||
		Object.keys(value).length !== 2 ||
		typeof value.pid !== 'number' ||
		!Number.isSafeInteger(value.pid) ||
		value.pid < 1 ||
		typeof value.started !== 'string' ||
		!/^\d+$/u.test(value.started)
	) {
		throw new ModuleRuntimeFailure('cleanup_failed');
	}
	return { pid: value.pid, started: value.started };
}

async function privateEntry(path: string, directory: boolean, maxBytes = Number.MAX_SAFE_INTEGER): Promise<void> {
	const stat = await lstat(path);
	if (
		stat.isSymbolicLink() ||
		(directory ? !stat.isDirectory() : !stat.isFile()) ||
		(stat.mode & 0o077) !== 0 ||
		(process.getuid && stat.uid !== process.getuid()) ||
		stat.size > maxBytes
	) {
		throw new ModuleRuntimeFailure('cleanup_failed');
	}
}

async function alive(identity: ProcessIdentity): Promise<boolean> {
	const current = await processIdentity(identity.pid);
	return current !== null && current.started === identity.started;
}

async function recoverInstance(root: string): Promise<void> {
	await privateEntry(root, true);
	const ownerPath = join(root, '.nexus-owner.json');
	await privateEntry(ownerPath, false, 4096);
	const owner = readIdentity(JSON.parse(await readFile(ownerPath, 'utf8')));
	if (await alive(owner)) {
		throw new ModuleRuntimeFailure('unavailable');
	}
	const journalPath = join(root, '.nexus-process.json');
	let journal: unknown;
	try {
		await privateEntry(journalPath, false, 4096);
		const text = await readFile(journalPath, 'utf8');
		if (Buffer.byteLength(text) > 4096) {
			throw new ModuleRuntimeFailure('cleanup_failed');
		}
		journal = JSON.parse(text);
	} catch (error) {
		if (!missing(error)) {
			throw error;
		}
		// The pre-spawn marker is deliberately durable before starting a child.
		// A missing identity after spawn is uncertain; preserve the directory.
		try {
			await lstat(join(root, '.nexus-spawning'));
		} catch (markerError) {
			if (missing(markerError)) {
				await removeModuleDirectory(root);
				return;
			}
			throw markerError;
		}
		throw new ModuleRuntimeFailure('cleanup_failed');
	}
	if (
		journal === null ||
		typeof journal !== 'object' ||
		Array.isArray(journal) ||
		!('parent' in journal) ||
		!('child' in journal) ||
		Object.keys(journal).length !== 2
	) {
		throw new ModuleRuntimeFailure('cleanup_failed');
	}
	const parent = readIdentity(journal.parent),
		child = readIdentity(journal.child);
	if (parent.pid !== owner.pid || parent.started !== owner.started) {
		throw new ModuleRuntimeFailure('cleanup_failed');
	}
	if (await alive(parent)) {
		throw new ModuleRuntimeFailure('unavailable');
	}
	if (await alive(child)) {
		let command: Buffer;
		try {
			command = await readFile(`/proc/${child.pid}/cmdline`);
		} catch (error) {
			if (missing(error) && !(await alive(child))) {
				await removeModuleDirectory(root);
				return;
			}
			throw error;
		}
		const worker = join(root, '.nexus-runtime.mjs');
		if ((await alive(child)) && !command.toString('utf8').split('\0').includes(worker)) {
			throw new ModuleRuntimeFailure('cleanup_failed');
		}
		// Compare the birth identity again immediately before signalling; never
		// treat a stored PID on its own as ownership of an unrelated process.
		if (await alive(child)) {
			try {
				process.kill(child.pid, 'SIGKILL');
			} catch (error) {
				if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
					throw error;
				}
			}
		}
		const deadline = Date.now() + 5000;
		while (await alive(child)) {
			if (Date.now() >= deadline) {
				throw new ModuleRuntimeFailure('cleanup_failed');
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
	await removeModuleDirectory(root);
}

export async function recoverModuleDirectories(root: string): Promise<void> {
	await privateEntry(root, true);
	const failures: unknown[] = [];
	const directory = await opendir(root);
	let count = 0;
	for await (const entry of directory) {
		if (++count > 128) {
			failures.push(new ModuleRuntimeFailure('cleanup_failed'));
			break;
		}
		try {
			if (!entry.isDirectory() || !/^instance-[A-Za-z0-9]{6}$/u.test(entry.name)) {
				throw new ModuleRuntimeFailure('cleanup_failed');
			}
			await recoverInstance(join(root, entry.name));
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length) {
		throw new ModuleRuntimeFailure('cleanup_failed', {
			cause: new AggregateError(failures, 'Isolated module recovery unconfirmed'),
		});
	}
}

export async function syncModuleDirectory(path: string): Promise<void> {
	const directory = await open(path, 'r');
	const failures: unknown[] = [];
	try {
		await directory.sync();
	} catch (error) {
		failures.push(error);
	}
	try {
		await directory.close();
	} catch (error) {
		failures.push(error);
	}
	if (failures.length) {
		throw new ModuleRuntimeFailure('cleanup_failed', {
			cause: new AggregateError(failures, 'Directory durability unconfirmed'),
		});
	}
}

export async function writeProcessJournal(path: string, content: string): Promise<void> {
	const file = await open(path, 'wx', 0o600);
	const failures: unknown[] = [];
	try {
		await file.writeFile(content);
		await file.sync();
	} catch (error) {
		failures.push(error);
	}
	try {
		await file.close();
	} catch (error) {
		failures.push(error);
	}
	try {
		await syncModuleDirectory(join(path, '..'));
	} catch (error) {
		failures.push(error);
	}
	if (failures.length) {
		throw new ModuleRuntimeFailure('cleanup_failed', {
			cause: new AggregateError(failures, 'Process journal durability unconfirmed'),
		});
	}
}

export async function removeModuleDirectory(root: string): Promise<void> {
	await rm(root, { recursive: true, force: true });
	await syncModuleDirectory(join(root, '..'));
}
