import type { FilesystemChannel } from '../ports/filesystem-channel';
import type { DirectoryListing } from './filesystem-types';

const DIRECTORY_TTL_MS = 5 * 60 * 1000;
const MAX_DIRECTORIES = 20;
const MAX_ENTRIES = 20_000;
const MAX_ESTIMATED_BYTES = 8 * 1024 * 1024;

interface CachedDirectory {
	listing: DirectoryListing;
	expiresAt: number;
	estimatedBytes: number;
}

interface DirectoryCache {
	get(path: string): DirectoryListing | undefined;
	read(path: string): Promise<DirectoryListing | undefined>;
	invalidate(): void;
	canPrefetch(): boolean;
	dispose(): void;
}

export function createDirectoryCache(channel: FilesystemChannel): DirectoryCache {
	const snapshots = new Map<string, CachedDirectory>();
	const pending = new Map<string, { revision: number; promise: Promise<DirectoryListing | undefined> }>();
	const tasks = new Set<Promise<DirectoryListing | undefined>>();
	let revision = 0;
	let entryCount = 0;
	let estimatedBytes = 0;
	let disposed = false;

	const remove = (path: string): void => {
		const cached = snapshots.get(path);
		if (!cached) return;
		entryCount -= cached.listing.entries.length;
		estimatedBytes -= cached.estimatedBytes;
		snapshots.delete(path);
	};

	const get = (path: string): DirectoryListing | undefined => {
		const cached = snapshots.get(path);
		if (!cached) return;
		if (cached.expiresAt <= performance.now()) {
			remove(path);
			return;
		}
		snapshots.delete(path);
		snapshots.set(path, cached);
		return cached.listing;
	};

	const store = (listing: DirectoryListing): void => {
		const bytes = listing.entries.reduce(
			(total, entry) => total + 160 + 2 * (entry.name.length + entry.path.length + (entry.longName?.length ?? 0)),
			2 * listing.path.length,
		);
		remove(listing.path);
		if (listing.entries.length > MAX_ENTRIES || bytes > MAX_ESTIMATED_BYTES) return;
		while (
			snapshots.size >= MAX_DIRECTORIES ||
			entryCount + listing.entries.length > MAX_ENTRIES ||
			estimatedBytes + bytes > MAX_ESTIMATED_BYTES
		) {
			const oldest = snapshots.keys().next().value;
			if (oldest === undefined) break;
			remove(oldest);
		}
		snapshots.set(listing.path, {
			listing,
			expiresAt: performance.now() + DIRECTORY_TTL_MS,
			estimatedBytes: bytes,
		});
		entryCount += listing.entries.length;
		estimatedBytes += bytes;
	};

	const read = (path: string): Promise<DirectoryListing | undefined> => {
		if (disposed) return Promise.resolve(undefined);
		const cached = get(path);
		if (cached) return Promise.resolve(cached);
		const existing = pending.get(path);
		if (existing?.revision === revision) return existing.promise;
		const current = revision;
		const promise = Promise.resolve()
			.then(() => channel.listDirectory(path))
			.then((listing) => {
				if (disposed || current !== revision) return undefined;
				store(listing);
				return listing;
			})
			.catch((cause: unknown) => {
				if (disposed || current !== revision) return undefined;
				throw cause;
			})
			.finally(() => {
				tasks.delete(promise);
				if (pending.get(path)?.promise === promise) pending.delete(path);
			});
		tasks.add(promise);
		pending.set(path, { revision: current, promise });
		return promise;
	};

	const invalidate = (): void => {
		revision++;
		snapshots.clear();
		entryCount = 0;
		estimatedBytes = 0;
	};

	return {
		get,
		read,
		invalidate,

		canPrefetch: (): boolean => !disposed && tasks.size === 0,

		dispose(): void {
			disposed = true;
			invalidate();
		},
	};
}
