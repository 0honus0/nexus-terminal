import { constants } from 'node:fs';
import { mkdir, open, rename, rm, lstat, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NativeBlobStore } from '../../../blobs/adapters/native-blob-store.js';
import { SnapshotFailure } from '../snapshot-types.js';
import type { SnapshotArchive } from './snapshot-archive.js';

type SwapState = 'pending' | 'moving_original' | 'installing' | 'swapped' | 'reverting';

interface RootSwap {
	root: string;
	hadPrevious: boolean;
	state: SwapState;
}

interface RestoreJournal {
	version: 1;
	id: string;
	swaps: RootSwap[];
}

async function exists(path: string): Promise<boolean> {
	try {
		const facts = await lstat(path);
		if (!facts.isDirectory() || facts.isSymbolicLink()) {
			throw new SnapshotFailure('unavailable');
		}
		return true;
	} catch (cause) {
		if (cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
			return false;
		}
		throw cause;
	}
}

async function withHandle<T>(handle: FileHandle, work: (handle: FileHandle) => Promise<T>): Promise<T> {
	let failure: unknown = null;
	try {
		return await work(handle);
	} catch (cause) {
		failure = cause;
		throw cause;
	} finally {
		try {
			await handle.close();
		} catch (cleanup) {
			throw new SnapshotFailure('cleanup_failed', {
				cause:
					failure === null
						? cleanup
						: new AggregateError([failure, cleanup], 'Restore file operation and handle close failed'),
			});
		}
	}
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
	await withHandle(handle, (directory) => directory.sync());
}

function decodeJournal(input: unknown, roots: ReadonlyMap<string, string>): RestoreJournal {
	if (
		input === null ||
		typeof input !== 'object' ||
		!('version' in input) ||
		input.version !== 1 ||
		!('id' in input) ||
		typeof input.id !== 'string' ||
		!/^[a-f0-9-]{36}$/u.test(input.id) ||
		!('swaps' in input) ||
		!Array.isArray(input.swaps) ||
		Object.keys(input).length !== 3 ||
		input.swaps.length !== roots.size
	) {
		throw new SnapshotFailure('unavailable');
	}
	const seen = new Set<string>();
	const swaps = input.swaps.map((value: unknown): RootSwap => {
		if (
			value === null ||
			typeof value !== 'object' ||
			Object.keys(value).length !== 3 ||
			!('root' in value) ||
			typeof value.root !== 'string' ||
			!roots.has(value.root) ||
			seen.has(value.root) ||
			!('hadPrevious' in value) ||
			typeof value.hadPrevious !== 'boolean' ||
			!('state' in value)
		) {
			throw new SnapshotFailure('unavailable');
		}
		const state = value.state;
		if (
			state !== 'pending' &&
			state !== 'moving_original' &&
			state !== 'installing' &&
			state !== 'swapped' &&
			state !== 'reverting'
		) {
			throw new SnapshotFailure('unavailable');
		}
		seen.add(value.root);
		return { root: value.root, hadPrevious: value.hadPrevious, state };
	});
	return { version: 1, id: input.id, swaps };
}

/** Owns durable whole-root swaps. No application policy, SQL or product fields. */
export class NativeSnapshotRestoreFiles {
	private readonly journalPath: string;
	private readonly parent: string;

	constructor(
		private readonly dbPath: string,
		private readonly roots: ReadonlyMap<string, string>,
	) {
		this.parent = dirname(dbPath);
		this.journalPath = dbPath + '.restore-journal';
		for (const [root, path] of roots) {
			if (!/^[a-z][a-z0-9-]*$/u.test(root) || dirname(resolve(path)) !== this.parent) {
				throw new SnapshotFailure('invalid_registration');
			}
		}
		if (new Set(roots.values()).size !== roots.size) {
			throw new SnapshotFailure('invalid_registration');
		}
	}

	private directory(id: string, previous = false): string {
		return this.dbPath + '.restore-' + id + (previous ? '.previous' : '.staging');
	}

	private live(root: string): string {
		const path = this.roots.get(root);
		if (!path) {
			throw new SnapshotFailure('invalid_registration');
		}
		return path;
	}

	private async write(journal: RestoreJournal): Promise<void> {
		const temporary = this.journalPath + '.next';
		const handle = await open(
			temporary,
			constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
			0o600,
		);
		await withHandle(handle, async (file) => {
			await file.writeFile(JSON.stringify(journal), 'utf8');
			await file.sync();
		});
		await rename(temporary, this.journalPath);
		await syncDirectory(this.parent);
	}

	private async read(): Promise<RestoreJournal | null> {
		let handle;
		try {
			handle = await open(this.journalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
		} catch (cause) {
			if (cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
				return null;
			}
			throw cause;
		}
		return withHandle(handle, async (file) => {
			const facts = await file.stat();
			if (!facts.isFile() || facts.size > 16 * 1024) {
				throw new SnapshotFailure('unavailable');
			}
			return decodeJournal(JSON.parse(await file.readFile('utf8')), this.roots);
		});
	}

	async stage(files: SnapshotArchive['files'], signal: AbortSignal): Promise<RestoreJournal> {
		if (await this.read()) {
			throw new SnapshotFailure('unavailable');
		}
		const id = randomUUID();
		const swaps: RootSwap[] = [];
		for (const root of this.roots.keys()) {
			swaps.push({ root, hadPrevious: await exists(this.live(root)), state: 'pending' });
		}
		const journal: RestoreJournal = { version: 1, id, swaps };
		// Journal first: a crash anywhere in staging leaves a discoverable cleanup owner.
		await this.write(journal);
		await mkdir(this.directory(id), { mode: 0o700 });
		await mkdir(this.directory(id, true), { mode: 0o700 });
		await syncDirectory(this.parent);
		const stores = new Map<string, NativeBlobStore>();
		for (const root of this.roots.keys()) {
			stores.set(root, await NativeBlobStore.open(join(this.directory(id), root)));
		}
		for (const file of files) {
			signal.throwIfAborted();
			const store = stores.get(file.reference.root);
			if (!store) {
				throw new SnapshotFailure('invalid_archive');
			}

			async function* content(): AsyncIterable<Uint8Array> {
				yield file.content;
			}

			const facts = await store.write(file.reference.key, content(), file.reference.bytes, signal);
			if (facts.sha256 !== file.reference.sha256) {
				throw new SnapshotFailure('invalid_archive');
			}
		}
		await syncDirectory(this.directory(id));
		await syncDirectory(this.directory(id, true));
		return journal;
	}

	async publish(journal: RestoreJournal): Promise<void> {
		for (const swap of journal.swaps) {
			swap.state = 'moving_original';
			await this.write(journal);
			if (swap.hadPrevious) {
				await rename(this.live(swap.root), join(this.directory(journal.id, true), swap.root));
				await syncDirectory(this.directory(journal.id, true));
				await syncDirectory(this.parent);
			}
			swap.state = 'installing';
			await this.write(journal);
			await rename(join(this.directory(journal.id), swap.root), this.live(swap.root));
			await syncDirectory(this.directory(journal.id));
			await syncDirectory(this.parent);
			swap.state = 'swapped';
			await this.write(journal);
		}
	}

	private async finish(journal: RestoreJournal): Promise<void> {
		await rm(this.directory(journal.id), { recursive: true, force: true });
		await rm(this.directory(journal.id, true), { recursive: true, force: true });
		await syncDirectory(this.parent);
		await rm(this.journalPath, { force: true });
		await syncDirectory(this.parent);
	}

	private async rollback(journal: RestoreJournal): Promise<void> {
		for (const swap of [...journal.swaps].reverse()) {
			if (swap.state === 'pending') {
				continue;
			}
			const previous = join(this.directory(journal.id, true), swap.root);
			const hasPrevious = await exists(previous);
			if (swap.hadPrevious && !hasPrevious) {
				if (
					(swap.state !== 'moving_original' && swap.state !== 'reverting') ||
					!(await exists(this.live(swap.root)))
				) {
					throw new SnapshotFailure('unavailable');
				}
			} else {
				swap.state = 'reverting';
				await this.write(journal);
				await rm(this.live(swap.root), { recursive: true, force: true });
				if (hasPrevious) {
					await rename(previous, this.live(swap.root));
				}
				await syncDirectory(this.directory(journal.id, true));
				await syncDirectory(this.parent);
			}
			// Restart can distinguish already reverted roots from candidate roots.
			swap.state = 'pending';
			await this.write(journal);
		}
		await this.finish(journal);
	}

	async recover(committed: (id: string) => Promise<boolean>): Promise<void> {
		const journal = await this.read();
		if (!journal) {
			return;
		}
		if (await committed(journal.id)) {
			if (journal.swaps.some((swap) => swap.state !== 'swapped')) {
				throw new SnapshotFailure('unavailable');
			}
			await this.finish(journal);
		} else {
			await this.rollback(journal);
		}
	}

	async finalize(journal: RestoreJournal): Promise<boolean> {
		try {
			await this.finish(journal);
			return false;
		} catch {
			return true;
		}
	}
}
