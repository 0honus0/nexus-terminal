import path from 'node:path';
import { streamFileZip } from '../model/file-zip-model.js';
import type { FileZipEntry } from '../model/file-task-types.js';
import { RemoteFileFailure, type FileResource } from '../model/file-types.js';

const SFTP_RPC_MS = 300_000;

/**
 * Create a streamed ZIP from an authorized application FileResource. No
 * archive bytes are buffered in Service, and one SFTP source reader is
 * admitted at a time to avoid exhausting the SSH channel's stream budget.
 *
 * The old directory ZIP followed symlinks but did not cap total traversal;
 * this implementation also checks realpath ancestors to stop link cycles.
 */
export async function streamRemoteDirectoryZip(
	resource: FileResource,
	root: string,
	remaining: () => number,
	signal: AbortSignal,
	onPlan: (filename: string) => Promise<void>,
	onChunk: (chunk: Uint8Array, signal: AbortSignal) => Promise<void>,
): Promise<void> {
	const info = await resource.stat({
		path: root,
		followLinks: true,
		timeoutMs: Math.min(remaining(), SFTP_RPC_MS),
		signal,
	});
	if (info.kind !== 'directory') {
		throw new RemoteFileFailure('invalid_input');
	}

	const entries = (signal: AbortSignal): AsyncIterable<FileZipEntry> => scan(root, '', new Set<string>(), signal);

	const scan = async function* (
		directory: string,
		archivePrefix: string,
		ancestors: ReadonlySet<string>,
		signal: AbortSignal,
	): AsyncIterable<FileZipEntry> {
		remaining();
		if (signal.aborted) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		const real = await resource.realpath({
			path: directory,
			timeoutMs: Math.min(remaining(), SFTP_RPC_MS),
			signal,
		});
		if (ancestors.has(real)) {
			return;
		}
		const nextAncestors = new Set(ancestors);
		nextAncestors.add(real);
		const entries = await resource.scan({
			path: directory,
			timeoutMs: Math.min(remaining(), SFTP_RPC_MS),
			signal,
		});
		for (const item of entries) {
			remaining();
			if (signal.aborted) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			if (item.name === '.' || item.name === '..' || item.name.includes('/') || item.name.includes('\\')) {
				throw new RemoteFileFailure('invalid_input');
			}
			const source = path.posix.join(directory, item.name);
			const entryName = archivePrefix ? archivePrefix + '/' + item.name : item.name;
			const target =
				item.info.kind === 'symlink'
					? await resource.stat({
							path: source,
							followLinks: true,
							timeoutMs: Math.min(remaining(), SFTP_RPC_MS),
							signal,
						})
					: item.info;
			if (target.kind === 'directory') {
				yield { kind: 'directory', name: entryName };
				yield* scan(source, entryName, nextAncestors, signal);
			} else if (target.kind === 'file') {
				if (!Number.isSafeInteger(target.size) || target.size < 0) {
					throw new RemoteFileFailure('invalid_input');
				}
				const sourceBytes = await resource.openRead({
					path: source,
					start: 0,
					length: target.size,
					maxBytes: target.size,
					timeoutMs: remaining(),
					signal,
				});
				yield { kind: 'file', name: entryName, bytes: sourceBytes };
			}
		}
	};

	await onPlan(path.posix.basename(root === '/' ? 'root' : root) + '.zip');
	await streamFileZip(entries, signal, async (bytes, abort) => {
		remaining();
		await onChunk(bytes, abort);
	});
}
