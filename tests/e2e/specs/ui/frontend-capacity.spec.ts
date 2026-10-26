import { expect, test } from '../../support/fixtures';
import { parseConnectionScript } from '../../../../packages/frontend/src/features/connections/model/connection-script';
import { createDirectoryCache } from '../../../../packages/frontend/src/features/filesystem/model/directory-cache';
import type { FilesystemChannel } from '../../../../packages/frontend/src/features/filesystem/ports/filesystem-channel';
import { FilesystemFailure } from '../../../../packages/frontend/src/features/filesystem/model/filesystem-types';
import type { DirectoryListing } from '../../../../packages/frontend/src/features/filesystem/model/filesystem-types';

const unused = (): never => {
	throw new Error('Unexpected filesystem operation');
};

function directoryChannel(listDirectory: FilesystemChannel['listDirectory']): FilesystemChannel {
	return {
		onInvalidate: () => () => undefined,

		listDirectory,
		search: unused,
		stat: unused,
		readBinary: unused,
		writeText: unused,
		createDirectory: unused,
		createFile: unused,
		remove: unused,
		rename: unused,
		chmod: unused,
		realpath: unused,
	};
}

test('local connection scripts preserve more than 500 entries and one MiB before protocol batching', () => {
	const source = Array.from(
		{ length: 501 },
		(_, index) => `user@host.example -name "bulk-${index}" -note "${'n'.repeat(2200)}"`,
	).join('\n');
	expect(new TextEncoder().encode(source).byteLength).toBeGreaterThan(1024 * 1024);
	const inputs = parseConnectionScript(source, [], []);
	expect(inputs).toHaveLength(501);
	expect(inputs[500]?.connection.name).toBe('bulk-500');
	expect(inputs[500]?.connection.notes).toBe('n'.repeat(2200));
	expect(() => parseConnectionScript(`${source}\ninvalid-line`, [], [])).toThrow();
});

test('slow directory reads beyond eight preserve deduplication, failures and invalidation', async () => {
	const pending = new Map<string, (listing: DirectoryListing) => void>();
	const failure = new FilesystemFailure('forbidden', false);
	const cache = createDirectoryCache(
		directoryChannel((directory) => {
			if (directory === '/denied') return Promise.reject(failure);
			return new Promise((resolve) => pending.set(directory, resolve));
		}),
	);
	const reads = Array.from({ length: 12 }, (_, index) => cache.read(`/slow-${index}`));
	expect(cache.read('/slow-0')).toBe(reads[0]);
	const settled = Promise.allSettled(reads);
	await Promise.resolve();
	for (const [directory, resolve] of pending) resolve({ path: directory, entries: [] });
	const results = await settled;
	expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
	expect(cache.get('/slow-11')?.path).toBe('/slow-11');
	await expect(cache.read('/denied')).rejects.toBe(failure);

	const stale = cache.read('/stale');
	await Promise.resolve();
	cache.invalidate();
	pending.get('/stale')?.({ path: '/stale', entries: [] });
	expect(await stale).toBeUndefined();
	expect(cache.get('/stale')).toBeUndefined();
	cache.dispose();
	expect(await cache.read('/closed')).toBeUndefined();
});
