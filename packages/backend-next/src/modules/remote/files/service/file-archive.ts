import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { FileResource, FileInfo } from '../model/file-types.js';
import { FileCommandNotStarted, RemoteFileFailure } from '../model/file-types.js';
import { ArchiveRejection, type ArchiveFormat, type FileArchiveEntry } from '../model/file-task-types.js';
import { FileArchiveModel } from '../model/file-archive-model.js';

import {
	ARCHIVE_MAX_ENTRIES as LIMIT,
	ARCHIVE_MAX_BYTES as UNPACK_BYTES,
	ARCHIVE_MAX_DEPTH as MAX_DEPTH,
	ARCHIVE_UNSAFE_CHARACTER as UNSAFE_LINE_CHARACTER,
	validateListing,
	resolveLinkTargets,
	resolveHardlinkTargets,
} from '../file-archive-rules.js';

const CLEANUP_MS = 5_000;

async function stat(
	resource: FileResource,
	name: string,
	remaining: () => number,
	signal: AbortSignal,
): Promise<FileInfo | null> {
	try {
		return await resource.stat({
			path: name,
			followLinks: false,
			timeoutMs: Math.min(remaining(), 300_000),
			signal,
		});
	} catch (error) {
		if (error instanceof RemoteFileFailure && error.code === 'not_found') {
			return null;
		}
		throw error;
	}
}

/**
 * A filename with a line break could forge a native tool progress line.
 * Check the source tree via SFTP before launching the archive command.
 */
async function inspectSources(
	resource: FileResource,
	paths: readonly string[],
	excluded: ReadonlySet<string>,
	remaining: () => number,
	signal: AbortSignal,
): Promise<number> {
	let count = 0;

	async function visit(name: string, metadata: FileInfo, depth: number): Promise<void> {
		if (excluded.has(name)) {
			return;
		}
		if (depth > MAX_DEPTH || ++count > LIMIT) {
			throw new RemoteFileFailure('limit_exceeded');
		}
		if (metadata.kind !== 'file' && metadata.kind !== 'directory' && metadata.kind !== 'symlink') {
			throw new RemoteFileFailure('invalid_input');
		}
		if (metadata.kind !== 'directory') {
			return;
		}
		const children = await resource.scan({
			path: name,
			maxEntries: Math.max(1, LIMIT - count + 1),
			timeoutMs: Math.min(remaining(), 300_000),
			signal,
		});
		if (count + children.length > LIMIT) {
			throw new RemoteFileFailure('limit_exceeded');
		}
		for (const child of children) {
			if (
				!child.name ||
				child.name === '.' ||
				child.name === '..' ||
				child.name.includes('/') ||
				UNSAFE_LINE_CHARACTER.test(child.name)
			) {
				throw new RemoteFileFailure('invalid_input');
			}
			await visit(path.posix.join(name, child.name), child.info, depth + 1);
		}
	}

	for (const name of paths) {
		if (UNSAFE_LINE_CHARACTER.test(name)) {
			throw new RemoteFileFailure('invalid_input');
		}
		const metadata = await resource.stat({
			path: name,
			followLinks: false,
			timeoutMs: Math.min(remaining(), 300_000),
			signal,
		});
		await visit(name, metadata, 0);
	}
	return count;
}

async function inspect(
	resource: FileResource,
	archive: string,
	format: ArchiveFormat,
	remaining: () => number,
	signal: AbortSignal,
	password?: string,
): Promise<Map<string, FileArchiveEntry>> {
	const model = new FileArchiveModel(resource);
	const listing = await model.list(archive, format, remaining, signal);
	const members = validateListing(listing.names, listing.modes, format, archive);
	for (const member of members.values()) {
		if (member.kind === 'symlink' && format === 'zip') {
			if (member.size > 4096) {
				throw new RemoteFileFailure('limit_exceeded');
			}
			member.linkTarget = await model.readZipLinkTarget(archive, member.rawName, remaining, signal, password);
			if (Buffer.byteLength(member.linkTarget, 'utf8') !== member.size) {
				throw new RemoteFileFailure('invalid_input');
			}
		}
	}
	return members;
}

export async function compressRemoteArchive(
	resource: FileResource,
	paths: readonly string[],
	destination: string,
	format: ArchiveFormat,
	remaining: () => number,
	signal: AbortSignal,
	onMutation: () => void,
	onProgress: (fileCount: number) => void,
	onWarning: (warning: string) => void,
	password?: string,
): Promise<number> {
	if (format !== 'zip' && password !== undefined) {
		throw new RemoteFileFailure('invalid_input');
	}
	const root = path.posix.dirname(destination);
	// When the selected directory itself contains the requested output,
	// archive it from its parent. Running in the output directory would
	// otherwise produce an empty relative source path and reject a valid case.
	const enclosingSource = paths.find((source) => source === root || root.startsWith(source + '/'));
	const workingDirectory = enclosingSource ? path.posix.dirname(enclosingSource) : root;
	paths.forEach((source) => {
		if (source === destination) {
			throw new RemoteFileFailure('invalid_input');
		}
		const rel = path.posix.relative(workingDirectory, source);
		if (!rel || rel === '..' || rel.startsWith('../')) {
			throw new RemoteFileFailure('invalid_input');
		}
	});
	for (const source of paths) {
		if (paths.filter((item) => item === source || source.startsWith(item + '/')).length !== 1) {
			throw new RemoteFileFailure('conflict');
		}
	}
	const previous = await stat(resource, destination, remaining, signal);
	if (previous && previous.kind !== 'file') {
		throw new RemoteFileFailure('conflict');
	}
	// Info-ZIP appends ".zip" when its output name has an unknown extension.
	// Keep the real remote filename identical to the SFTP commit source.
	const extension = format === 'zip' ? '.part.zip' : format === 'tar.gz' ? '.part.tar.gz' : '.part.tar.bz2';
	const temporary = path.posix.join(root, '.nexus-archive-' + randomUUID() + extension);
	const expected = await inspectSources(resource, paths, new Set([temporary, destination]), remaining, signal);
	// Archive entries are emitted relative to the working directory; Info-ZIP
	// omits the leading "./", while GNU tar retains it. Exclude both variants
	// so a source tree containing the output never archives the growing file,
	// and replacing an existing archive does not include its previous bytes.
	const relativeOutput = path.posix.relative(workingDirectory, temporary);
	const relativePrevious = path.posix.relative(workingDirectory, destination);
	const excluded = [relativeOutput, relativePrevious];
	let count = 0;
	let finished = false;
	let nativeEnded = false;
	let warning: string | undefined;
	try {
		onMutation();
		const result = await new FileArchiveModel(resource).compress(
			workingDirectory,
			paths,
			temporary,
			excluded,
			format,
			LIMIT,
			remaining,
			signal,
			onProgress,
			password,
		);
		const outcome = result.outcome;
		count = result.count;
		finished = result.finished;
		nativeEnded = result.writerExited;
		if (!nativeEnded && !(outcome.status === 'rejected' && outcome.failure instanceof ArchiveRejection)) {
			throw new RemoteFileFailure('operation_unknown');
		}
		if (outcome.status === 'rejected') {
			if (outcome.failure instanceof ArchiveRejection) {
				throw outcome.failure;
			}
			if (
				outcome.failure.code !== 'remote_unavailable' ||
				format !== 'zip' ||
				password !== undefined ||
				count === 0 ||
				count > expected
			) {
				throw outcome.failure;
			}
			// Preserve the legacy ZIP warning result only for an independently
			// verified archive. Other nonzero exits never publish a partial file.
			if (!(await new FileArchiveModel(resource).verifyZip(temporary, remaining, signal))) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			warning = 'Archive completed with a verified warning';
		}
		if (!warning && (!finished || count !== expected)) {
			throw new RemoteFileFailure('operation_unknown');
		}
		const staged = await resource.stat({
			path: temporary,
			followLinks: false,
			timeoutMs: Math.min(remaining(), 300_000),
			signal,
		});
		if (staged.kind !== 'file' || staged.size < 1) {
			throw new RemoteFileFailure('operation_unknown');
		}
		const move = { from: temporary, to: destination, timeoutMs: Math.min(remaining(), 300_000), signal };
		if (previous) {
			await resource.replace(move);
		} else {
			await resource.rename(move);
		}
		const saved = await resource.stat({
			path: destination,
			followLinks: false,
			timeoutMs: Math.min(remaining(), 300_000),
			signal,
		});
		if (saved.kind !== 'file' || saved.size !== staged.size) {
			throw new RemoteFileFailure('operation_unknown');
		}
		if (warning) {
			onWarning(warning);
		}
		return count;
	} catch (cause) {
		// Remove the private partial output only after a confirmed native exit.
		// An unknown SSH outcome may still have a remote writer.
		if (nativeEnded && resource.isOpen) {
			try {
				await resource.remove({ path: temporary, timeoutMs: CLEANUP_MS, signal: new AbortController().signal });
			} catch (cleanup) {
				if (!(cleanup instanceof RemoteFileFailure && cleanup.code === 'not_found')) {
					throw new RemoteResourceCleanupFailure([cause, cleanup]);
				}
			}
		}
		if (
			cause instanceof RemoteResourceCleanupFailure ||
			cause instanceof ArchiveRejection ||
			cause instanceof FileCommandNotStarted
		) {
			throw cause;
		}
		throw new RemoteFileFailure('operation_unknown', { cause });
	}
}

export async function decompressRemoteArchive(
	resource: FileResource,
	source: string,
	format: ArchiveFormat,
	remaining: () => number,
	signal: AbortSignal,
	onMutation: () => void,
	onProgress: (fileCount: number) => void,
	password?: string,
): Promise<number> {
	if (format !== 'zip' && password !== undefined) {
		throw new RemoteFileFailure('invalid_input');
	}
	const root = path.posix.dirname(source);
	const src = await resource.stat({
		path: source,
		followLinks: false,
		timeoutMs: Math.min(remaining(), 300_000),
		signal,
	});
	if (src.kind !== 'file') {
		throw new RemoteFileFailure('invalid_input');
	}
	const directory = await resource.stat({
		path: root,
		followLinks: false,
		timeoutMs: Math.min(remaining(), 300_000),
		signal,
	});
	if (directory.kind !== 'directory') {
		throw new RemoteFileFailure('conflict');
	}
	const canonicalRoot = await resource.realpath({
		path: root,
		timeoutMs: Math.min(remaining(), 300_000),
		signal,
	});
	// Inspect and extract the same private on-host copy, rather than allowing
	// another SFTP write to swap the original archive between the two commands.
	// This uses native cp and keeps archive bytes off the Node.js backend.
	const snapshotSuffix = format === 'zip' ? '.part.zip' : format === 'tar.gz' ? '.part.tar.gz' : '.part.tar.bz2';
	const snapshot = path.posix.join(root, '.nexus-archive-source-' + randomUUID() + snapshotSuffix);
	const stage = path.posix.join(root, '.nexus-extract-' + randomUUID() + '.part');
	// Prevent a TAR "./" directory entry from chmodding the private
	// extraction root and exposing its contents during extraction.
	let extractorExited = false;
	let extractionDispatched = false;
	let canRemoveSnapshot = false;

	async function removeSnapshot(): Promise<void> {
		try {
			await resource.remove({ path: snapshot, timeoutMs: CLEANUP_MS, signal: new AbortController().signal });
		} catch (cause) {
			if (cause instanceof RemoteFileFailure && cause.code === 'not_found') {
				return;
			}
			throw new RemoteResourceCleanupFailure([cause]);
		}
	}

	try {
		// The private copy is not a published user-visible mutation. A
		// deterministic invalid archive should still produce invalid_input
		// after its confirmed private snapshot has been cleaned.
		const copy = await new FileArchiveModel(resource).copySnapshot(source, snapshot, remaining, signal);
		// A completed process outcome proves cp cannot write to this snapshot
		// any longer, even if its exit code reports an error.
		canRemoveSnapshot = true;
		if (copy.status === 'rejected') {
			throw copy.failure;
		}
		const savedSnapshot = await resource.stat({
			path: snapshot,
			followLinks: false,
			timeoutMs: Math.min(remaining(), 300_000),
			signal,
		});
		if (savedSnapshot.kind !== 'file' || savedSnapshot.size !== src.size) {
			throw new RemoteFileFailure('operation_unknown');
		}
		// Metadata preflight must finish before extracting any archive member.
		// If its SSH status becomes unknown, do not race that command's cleanup.
		let members: Map<string, FileArchiveEntry>;
		try {
			members = await inspect(resource, snapshot, format, remaining, signal, password);
		} catch (cause) {
			if (cause instanceof RemoteFileFailure && cause.code === 'operation_unknown') {
				canRemoveSnapshot = false;
			}
			throw cause;
		}
		const linkTargets = resolveLinkTargets(members);
		const hardlinkTargets = resolveHardlinkTargets(members);
		for (const [name, link] of hardlinkTargets) {
			const member = members.get(name);
			if (!member) {
				throw new RemoteFileFailure('invalid_input');
			}
			member.size = link.size;
		}
		if (members.has(path.posix.basename(source))) {
			throw new RemoteFileFailure('invalid_input');
		}
		canRemoveSnapshot = false;
		onMutation();
		extractionDispatched = true;
		let result;
		try {
			result = await new FileArchiveModel(resource).extract(
				{
					snapshot,
					stage,
					format,
					excludedMembers: [...members.values()]
						.filter((member) => member.kind === 'symlink' || member.hardlink)
						.map((member) => member.rawName),
					hasContent: [...members.values()].some((member) => member.kind !== 'symlink' && !member.hardlink),
				},
				remaining,
				signal,
				password,
			);
		} catch (cause) {
			// A definite pre-dispatch failure cannot leave a remote extractor
			// reading this snapshot. Unknown outcomes must retain it.
			if (cause instanceof FileCommandNotStarted) {
				extractionDispatched = false;
				canRemoveSnapshot = true;
			}
			throw cause;
		}
		extractorExited = true;
		canRemoveSnapshot = true;
		if (result.outcome.status === 'rejected') {
			throw result.outcome.failure;
		}
		if (!result.done) {
			throw new RemoteFileFailure('operation_unknown');
		}

		/** Bound path checks detect changes; SFTP cannot make them atomic with the next operation. */
		async function checkStageDirectory(name: string): Promise<void> {
			const parts = name === '.' || name === '' ? [] : name.split('/');
			for (let i = 0; i <= parts.length; i++) {
				const absolute = path.posix.join(stage, ...parts.slice(0, i));
				const current = await stat(resource, absolute, remaining, signal);
				if (
					current?.kind !== 'directory' ||
					(i === 0 && (current.mode & 0o7777) !== 0o700) ||
					(await resource.realpath({ path: absolute, timeoutMs: Math.min(remaining(), 300_000), signal })) !==
						path.posix.join(canonicalRoot, path.posix.basename(stage), ...parts.slice(0, i))
				) {
					throw new RemoteFileFailure('conflict');
				}
			}
		}

		// Confirm what native tools actually unpacked, not just their metadata.
		// Symlinks are never followed by this recursive SFTP check.
		const unseen = new Set(members.keys());
		const implicitDirs = new Set<string>();
		const stagedMetadata = new Map<string, FileInfo>();
		let extractedFiles = 0;
		let extractedBytes = 0;
		for (const name of members.keys()) {
			const parts = name.split('/');
			for (let i = 1; i < parts.length; i++) {
				implicitDirs.add(parts.slice(0, i).join('/'));
			}
		}

		async function prepareStageDirectories(): Promise<void> {
			// Make only validated directory paths temporarily inspectable. Capture
			// native attributes first and normalize parents before their children;
			// traversing with find cannot reliably enter a mode=000 directory.
			const directories = new Set(implicitDirs);
			for (const [name, member] of members) {
				if (member.kind === 'directory') {
					directories.add(name);
				}
			}
			for (const name of [...directories].sort((a, b) => a.split('/').length - b.split('/').length)) {
				await checkStageDirectory(path.posix.dirname(name));
				const absolute = path.posix.join(stage, name);
				let metadata = await stat(resource, absolute, remaining, signal);
				if (!metadata && !members.has(name)) {
					await resource.mkdir({ path: absolute, timeoutMs: Math.min(remaining(), 300_000), signal });
					await resource.chmod({
						path: absolute,
						mode: 0o700,
						timeoutMs: Math.min(remaining(), 300_000),
						signal,
					});
					metadata = await stat(resource, absolute, remaining, signal);
				}
				if (!metadata || metadata.kind !== 'directory' || (metadata.mode & 0o6000) !== 0) {
					throw new RemoteFileFailure('invalid_input');
				}
				await checkStageDirectory(name);
				stagedMetadata.set(name, metadata);
				await resource.chmod({
					path: absolute,
					mode: (metadata.mode & 0o1777) | 0o700,
					timeoutMs: Math.min(remaining(), 300_000),
					signal,
				});
			}
		}

		async function validate(dir: string, prefix: string): Promise<void> {
			await checkStageDirectory(prefix);
			for (const entry of await resource.scan({
				path: dir,
				maxEntries: LIMIT + 1,
				timeoutMs: Math.min(remaining(), 300_000),
				signal,
			})) {
				if (++extractedFiles > LIMIT) {
					throw new RemoteFileFailure('limit_exceeded');
				}
				const name = prefix ? prefix + '/' + entry.name : entry.name;
				if (name.split('/').length > MAX_DEPTH + 1) {
					throw new RemoteFileFailure('limit_exceeded');
				}
				const kind = members.get(name)?.kind ?? (implicitDirs.has(name) ? 'directory' : null);
				if (!kind || kind !== entry.info.kind) {
					throw new RemoteFileFailure('invalid_input');
				}
				// GNU tar can restore privileged file bits with
				// --same-permissions. A transferred archive must not publish a
				// setuid/setgid executable, including when SSH runs as root.
				if ((entry.info.mode & 0o6000) !== 0) {
					throw new RemoteFileFailure('invalid_input');
				}
				if (kind === 'symlink') {
					const target = await resource.readlink({
						path: path.posix.join(dir, entry.name),
						timeoutMs: Math.min(remaining(), 300_000),
						signal,
					});
					if (target !== members.get(name)?.linkTarget) {
						throw new RemoteFileFailure('invalid_input');
					}
				}
				if (kind === 'file') {
					const claimed = members.get(name);
					if (!claimed || entry.info.size !== claimed.size) {
						throw new RemoteFileFailure('invalid_input');
					}
					extractedBytes += entry.info.size;
					if (extractedBytes > UNPACK_BYTES) {
						throw new RemoteFileFailure('limit_exceeded');
					}
				}
				if (!Number.isSafeInteger(entry.info.modifiedAt) || entry.info.modifiedAt < 0) {
					throw new RemoteFileFailure('invalid_input');
				}
				if (!stagedMetadata.has(name)) {
					stagedMetadata.set(name, entry.info);
				}
				unseen.delete(name);
				if (kind === 'directory') {
					await validate(path.posix.join(dir, entry.name), name);
				}
			}
		}

		await prepareStageDirectories();
		for (const [name, link] of hardlinkTargets) {
			await checkStageDirectory(path.posix.dirname(link.target));
			await checkStageDirectory(path.posix.dirname(name));
			const sourcePath = path.posix.join(stage, link.target);
			const destinationPath = path.posix.join(stage, name);
			const metadata = await stat(resource, sourcePath, remaining, signal);
			if (
				metadata?.kind !== 'file' ||
				metadata.size !== members.get(name)?.size ||
				(await stat(resource, destinationPath, remaining, signal))
			) {
				throw new RemoteFileFailure('invalid_input');
			}
			const result = await new FileArchiveModel(resource).createHardlink(
				stage,
				link.target,
				name,
				remaining,
				signal,
			);
			if (result.status === 'rejected') {
				throw result.failure;
			}
		}
		for (const [name, member] of members) {
			if (member.kind !== 'symlink') {
				continue;
			}
			await checkStageDirectory(path.posix.dirname(name));
			const absolute = path.posix.join(stage, name);
			if (await stat(resource, absolute, remaining, signal)) {
				throw new RemoteFileFailure('invalid_input');
			}
			if (member.linkTarget === null) {
				throw new RemoteFileFailure('invalid_input');
			}
			await resource.symlink(member.linkTarget, absolute, { timeoutMs: Math.min(remaining(), 300_000), signal });
		}
		await validate(stage, '');
		if (unseen.size !== 0) {
			throw new RemoteFileFailure('invalid_input');
		}

		async function checkParents(name: string): Promise<void> {
			const currentRoot = await resource.realpath({
				path: root,
				timeoutMs: Math.min(remaining(), 300_000),
				signal,
			});
			if (
				currentRoot !== canonicalRoot ||
				(await stat(resource, root, remaining, signal))?.kind !== 'directory'
			) {
				throw new RemoteFileFailure('conflict');
			}
			const parts = name.split('/');
			for (let i = 1; i < parts.length; i++) {
				const parent = parts.slice(0, i).join('/');
				const absolute = path.posix.join(root, parent);
				const current = await stat(resource, absolute, remaining, signal);
				if (!current) {
					return;
				}
				if (
					current.kind !== 'directory' ||
					(await resource.realpath({ path: absolute, timeoutMs: Math.min(remaining(), 300_000), signal })) !==
						path.posix.join(canonicalRoot, parent)
				) {
					throw new RemoteFileFailure('conflict');
				}
			}
		}

		async function checkLinkTarget(name: string): Promise<void> {
			const target = linkTargets.get(name);
			if (target === undefined) {
				return;
			}
			for (const directory of target.directories) {
				await checkParents(directory);
				const existing = await stat(resource, path.posix.join(root, directory), remaining, signal);
				if (existing && existing.kind !== 'directory') {
					throw new RemoteFileFailure('conflict');
				}
			}
			await checkParents(target.destination);
			const existing = await stat(resource, path.posix.join(root, target.destination), remaining, signal);
			if (existing && existing.kind !== 'file' && existing.kind !== 'directory') {
				throw new RemoteFileFailure('conflict');
			}
		}

		// Check known destination type conflicts before publishing any entry.
		// This does not create atomic filesystem isolation against a concurrent
		// remote writer; later per-entry checks are deliberately retained.
		for (const directoryName of implicitDirs) {
			const current = await stat(resource, path.posix.join(root, directoryName), remaining, signal);
			if (current && current.kind !== 'directory') {
				throw new RemoteFileFailure('conflict');
			}
		}
		for (const [name, member] of members) {
			await checkParents(name);
			await checkLinkTarget(name);
			const current = await stat(resource, path.posix.join(root, name), remaining, signal);
			if (current && current.kind !== member.kind) {
				throw new RemoteFileFailure('conflict');
			}
		}

		let count = 0;
		const createdDirectories = new Set<string>();

		async function publish(dir: string, prefix: string): Promise<void> {
			await checkStageDirectory(prefix);
			for (const entry of await resource.scan({
				path: dir,
				maxEntries: LIMIT + 1,
				timeoutMs: Math.min(remaining(), 300_000),
				signal,
			})) {
				const name = prefix ? prefix + '/' + entry.name : entry.name;
				const expected = stagedMetadata.get(name);
				await checkStageDirectory(prefix);
				const from = path.posix.join(dir, entry.name);
				const currentSource = await stat(resource, from, remaining, signal);
				if (
					!expected ||
					currentSource?.kind !== expected.kind ||
					(expected.kind === 'file' &&
						(currentSource.size !== expected.size ||
							currentSource.modifiedAt !== expected.modifiedAt ||
							(currentSource.mode & 0o7777) !== (expected.mode & 0o7777)))
				) {
					throw new RemoteFileFailure('invalid_input');
				}
				await checkParents(name);
				await checkLinkTarget(name);
				if (
					currentSource.kind === 'symlink' &&
					(await resource.readlink({
						path: path.posix.join(dir, entry.name),
						timeoutMs: Math.min(remaining(), 300_000),
						signal,
					})) !== members.get(name)?.linkTarget
				) {
					throw new RemoteFileFailure('operation_unknown');
				}
				const to = path.posix.join(root, name);
				const existing = await stat(resource, to, remaining, signal);
				if (currentSource.kind === 'directory') {
					if (existing && existing.kind !== 'directory') {
						throw new RemoteFileFailure('conflict');
					}
					if (!existing) {
						await resource.mkdir({ path: to, timeoutMs: Math.min(remaining(), 300_000), signal });
						await checkParents(name + '/');
						await resource.chmod({
							path: to,
							mode: 0o700,
							timeoutMs: Math.min(remaining(), 300_000),
							signal,
						});
						createdDirectories.add(name);
					}
					await publish(from, name);
					await resource.rmdir({ path: from, timeoutMs: Math.min(remaining(), 300_000), signal });
					if (members.has(name)) {
						count++;
						onProgress(count);
					}
				} else {
					if (
						existing &&
						(currentSource.kind !== existing.kind ||
							(existing.kind !== 'file' && existing.kind !== 'symlink'))
					) {
						throw new RemoteFileFailure('conflict');
					}
					const move = { from, to, timeoutMs: Math.min(remaining(), 300_000), signal };
					if (existing) {
						await resource.replace(move);
					} else {
						await resource.rename(move);
					}
					count++;
					onProgress(count);
				}
			}
		}

		async function restoreAttributes(): Promise<void> {
			for (const [name, metadata] of stagedMetadata) {
				if (metadata.kind !== 'symlink') {
					continue;
				}
				await checkParents(name);
				await checkLinkTarget(name);
				const absolute = path.posix.join(root, name);
				const current = await stat(resource, absolute, remaining, signal);
				if (
					current?.kind !== 'symlink' ||
					(await resource.readlink({ path: absolute, timeoutMs: Math.min(remaining(), 300_000), signal })) !==
						members.get(name)?.linkTarget
				) {
					throw new RemoteFileFailure('operation_unknown');
				}
			}

			// Native umask and merged directories must not silently replace archive
			// metadata. Restore children before parents, leaving restrictive modes last.
			const restoration = [...stagedMetadata].sort(([a], [b]) => b.split('/').length - a.split('/').length);
			for (const [name, metadata] of restoration) {
				if (metadata.kind === 'symlink') {
					continue;
				}
				if (metadata.kind === 'directory' && !members.has(name) && !createdDirectories.has(name)) {
					continue;
				}
				await checkParents(name);
				const absolute = path.posix.join(root, name);
				const mode = members.get(name)?.mode ?? metadata.mode & 0o1777;
				const current = await stat(resource, absolute, remaining, signal);
				if (
					!current ||
					current.kind !== metadata.kind ||
					(metadata.kind === 'file' &&
						(current.size !== metadata.size || current.modifiedAt !== metadata.modifiedAt))
				) {
					throw new RemoteFileFailure('operation_unknown');
				}
				if (current.modifiedAt !== metadata.modifiedAt) {
					await resource.utimes({
						path: absolute,
						accessedAt: metadata.accessedAt,
						modifiedAt: metadata.modifiedAt,
						timeoutMs: Math.min(remaining(), 300_000),
						signal,
					});
				}
				if ((current.mode & 0o1777) !== mode) {
					await resource.chmod({ path: absolute, mode, timeoutMs: Math.min(remaining(), 300_000), signal });
				}
				const saved = await stat(resource, absolute, remaining, signal);
				if (
					!saved ||
					saved.kind !== metadata.kind ||
					(saved.mode & 0o1777) !== mode ||
					saved.modifiedAt !== metadata.modifiedAt ||
					(metadata.kind === 'file' && saved.size !== metadata.size)
				) {
					throw new RemoteFileFailure('operation_unknown');
				}
			}
		}

		await publish(stage, '');
		await restoreAttributes();
		await resource.rmdir({ path: stage, timeoutMs: Math.min(remaining(), 300_000), signal });
		if (count !== members.size) {
			throw new RemoteFileFailure('operation_unknown');
		}
		// After publication, snapshot deletion is housekeeping. A failure to
		// confirm it must preserve the overall operation_unknown classification.
		canRemoveSnapshot = false;
		await removeSnapshot();
		return count;
	} catch (cause) {
		// Only a confirmed SSH process exit permits cleanup. In particular,
		// an aborted channel is not evidence that extraction has stopped.
		const cleanupFailures: unknown[] = [];
		if (extractorExited && resource.isOpen) {
			try {
				const cleanupOutcome = await resource.forceRemove({
					path: stage,
					privileged: false,
					timeoutMs: CLEANUP_MS,
					signal: new AbortController().signal,
				});
				if (cleanupOutcome !== 'completed') {
					throw new RemoteFileFailure('operation_unknown');
				}
			} catch (cleanup) {
				cleanupFailures.push(cleanup);
			}
		}
		if (canRemoveSnapshot && resource.isOpen) {
			canRemoveSnapshot = false;
			try {
				await removeSnapshot();
			} catch (cleanup) {
				cleanupFailures.push(cleanup);
			}
		}
		if (cleanupFailures.length > 0) {
			throw new RemoteResourceCleanupFailure([cause, ...cleanupFailures]);
		}
		if (cause instanceof RemoteResourceCleanupFailure) {
			throw cause;
		}
		if (!extractionDispatched && cause instanceof RemoteFileFailure) {
			throw cause;
		}
		if (cause instanceof ArchiveRejection || cause instanceof FileCommandNotStarted) {
			throw cause;
		}
		throw new RemoteFileFailure('operation_unknown', { cause });
	}
}
