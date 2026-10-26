import type { CopyProgress, FileDirectCopy } from '../model/file-task-types.js';
import path from 'node:path';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import {
	RemoteFileFailure,
	type FileEntry,
	type FileInfo,
	type FileResource,
	type FilePathEntry,
	type FileByteSource,
} from '../model/file-types.js';

const RPC_TIMEOUT_MS = 300_000;
const COPY_WRITE_WINDOW_BYTES = 256 * 1024;
const COPY_WRITE_WINDOWS = 4;

interface CopyContext {
	source: FileResource;
	destination: FileResource;
	remaining(): number;
	signal: AbortSignal;
	transferredBytes: number;
	completedFiles: number;
	totalBytes: number;
	totalFiles: number;
	totalKnown: boolean;
	mutationStarted: boolean;
	onMutation(): void;
	completedSources: Array<{ path: string; info: FileInfo; linkTarget?: string }>;
	onProgress(progress: CopyProgress): void;
}

function reportProgress(ctx: CopyContext, currentFile: string): void {
	if (ctx.transferredBytes > ctx.totalBytes) {
		ctx.totalKnown = false;
	}
	ctx.onProgress({
		transferredBytes: ctx.transferredBytes,
		completedFiles: ctx.completedFiles,
		totalBytes: ctx.totalKnown ? ctx.totalBytes : ctx.transferredBytes,
		totalFiles: ctx.totalFiles,
		totalKnown: ctx.totalKnown,
		currentFile,
	});
}

function options(ctx: CopyContext, filePath: string) {
	return { path: filePath, timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS), signal: ctx.signal };
}

async function optionalStat(resource: FileResource, ctx: CopyContext, filePath: string): Promise<FileInfo | null> {
	const timeoutMs = Math.min(ctx.remaining(), RPC_TIMEOUT_MS);
	let info: FileInfo;
	try {
		info = await resource.stat({
			path: filePath,
			timeoutMs,
			signal: ctx.signal,
			followLinks: false,
		});
	} catch (error) {
		if (error instanceof RemoteFileFailure && error.code === 'not_found') {
			ctx.remaining();
			return null;
		}
		throw error;
	}
	ctx.remaining();
	return info;
}

/** Resolve missing destination suffixes without creating them during preflight. */
async function destinationLocation(ctx: CopyContext, directory: string): Promise<string> {
	let existing = directory;
	const suffix: string[] = [];
	while (true) {
		const info = await optionalStat(ctx.destination, ctx, existing);
		if (info !== null) {
			if (info.kind !== 'directory') {
				throw new RemoteFileFailure('conflict');
			}
			const canonical = await ctx.destination.realpath(options(ctx, existing));
			return path.posix.join(canonical, ...suffix);
		}
		if (existing === '/') {
			throw new RemoteFileFailure('not_found');
		}
		suffix.unshift(path.posix.basename(existing));
		existing = path.posix.dirname(existing);
	}
}

async function mkdirParents(ctx: CopyContext, absolutePath: string): Promise<void> {
	const segments = absolutePath.split('/').filter(Boolean);
	let current = '/';
	for (const segment of segments) {
		current = path.posix.join(current, segment);
		const info = await optionalStat(ctx.destination, ctx, current);
		if (info === null) {
			ctx.mutationStarted = true;
			ctx.onMutation();
			await ctx.destination.mkdir(options(ctx, current));
		} else if (info.kind !== 'directory') {
			throw new RemoteFileFailure('conflict');
		}
	}
}

/** Bound copy buffering while allowing the stage to pipeline a full write window. */
async function* copyWriteWindows(source: FileByteSource): AsyncIterable<Uint8Array> {
	let buffer = new Uint8Array(COPY_WRITE_WINDOW_BYTES);
	let length = 0;
	for await (const chunk of source) {
		let offset = 0;
		while (offset < chunk.byteLength) {
			const size = Math.min(buffer.byteLength - length, chunk.byteLength - offset);
			buffer.set(chunk.subarray(offset, offset + size), length);
			length += size;
			offset += size;
			if (length === buffer.byteLength) {
				yield buffer;
				buffer = new Uint8Array(COPY_WRITE_WINDOW_BYTES);
				length = 0;
			}
		}
	}
	if (length > 0) {
		yield buffer.subarray(0, length);
	}
}

async function copyOneFile(ctx: CopyContext, from: string, to: string, info: FileInfo): Promise<FilePathEntry> {
	if (!Number.isSafeInteger(info.size) || info.size < 0) {
		throw new RemoteFileFailure('invalid_input');
	}
	const existing = await optionalStat(ctx.destination, ctx, to);
	if (existing !== null && existing.kind !== 'file') {
		throw new RemoteFileFailure('conflict');
	}
	await mkdirParents(ctx, path.posix.dirname(to));
	ctx.mutationStarted = true;
	ctx.onMutation();
	const stage = await ctx.destination.openUploadStage({
		path: to,
		timeoutMs: ctx.remaining(),
		signal: ctx.signal,
		mode: info.mode & 0o7777,
	});
	let committed = false;
	try {
		const source = await ctx.source.openRead({
			path: from,
			timeoutMs: ctx.remaining(),
			signal: ctx.signal,
			length: info.size,
			maxBytes: info.size,
			start: 0,
		});
		let lastReportedBytes = ctx.transferredBytes;
		const pending = new Set<Promise<void>>();
		const failures: unknown[] = [];
		try {
			for await (const chunk of copyWriteWindows(source)) {
				ctx.signal.throwIfAborted();
				ctx.remaining();
				if (failures.length > 0) {
					throw failures[0];
				}
				// One append fits one stage window: enqueue in source order,
				// then overlap its acknowledgement with subsequent reads/writes.
				const writing = stage.append(chunk).then(() => {
					ctx.transferredBytes += chunk.byteLength;
					if (ctx.transferredBytes - lastReportedBytes >= 512 * 1024) {
						reportProgress(ctx, from);
						lastReportedBytes = ctx.transferredBytes;
					}
				});
				const tracked = writing.then(
					() => {
						pending.delete(tracked);
					},
					(cause: unknown) => {
						failures.push(cause);
						pending.delete(tracked);
					},
				);
				pending.add(tracked);
				if (pending.size >= COPY_WRITE_WINDOWS) {
					await Promise.race(pending);
				}
			}
		} catch (cause) {
			if (!failures.includes(cause)) {
				failures.push(cause);
			}
		} finally {
			// A local cancellation does not stop queued SFTP writes. Settle
			// every acknowledgement before committing or discarding the stage.
			await Promise.all(pending);
		}
		if (failures.length === 1) {
			throw failures[0];
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Copy pipeline failed');
		}
		// The old transfer replaced existing regular destination files. The
		// new stage still prevents partial content becoming a visible file.
		ctx.remaining();
		await stage.commit(existing === null ? 'create' : 'replace');
		committed = true;
		// A successfully installed destination is already a side effect.
		// Failure while restoring or confirming metadata remains unknown.
		await ctx.destination.chmod({
			path: to,
			timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
			signal: ctx.signal,
			mode: info.mode & 0o7777,
		});
		await ctx.destination.utimes({
			path: to,
			timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
			signal: ctx.signal,
			accessedAt: info.accessedAt,
			modifiedAt: info.modifiedAt,
		});
		const result = await ctx.destination.stat({
			path: to,
			timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
			signal: ctx.signal,
			followLinks: false,
		});
		if (
			result.kind !== 'file' ||
			result.size !== info.size ||
			(result.mode & 0o7777) !== (info.mode & 0o7777) ||
			result.modifiedAt !== info.modifiedAt
		) {
			throw new RemoteFileFailure('operation_unknown');
		}
		ctx.completedFiles++;
		ctx.completedSources.push({ path: from, info });
		reportProgress(ctx, from);
		return { path: to, name: path.posix.basename(to), info: result };
	} catch (cause) {
		if (committed) {
			// The destination exists after commit. A post-write validation failure
			// is unknown, not evidence that this copy can be retried safely.
			throw new RemoteFileFailure('operation_unknown', { cause });
		}
		try {
			await stage.discard();
		} catch (cleanup) {
			throw new RemoteResourceCleanupFailure([cause, cleanup]);
		}
		throw cause;
	}
}

async function copyOneLink(ctx: CopyContext, from: string, to: string, info: FileInfo): Promise<FilePathEntry> {
	const target = await ctx.source.readlink(options(ctx, from));
	if (await optionalStat(ctx.destination, ctx, to)) {
		throw new RemoteFileFailure('conflict');
	}
	await mkdirParents(ctx, path.posix.dirname(to));
	ctx.mutationStarted = true;
	ctx.onMutation();
	// Legacy copy silently dereferenced links, changing file types and
	// sometimes traversing cycles. Preserve the link object explicitly.
	await ctx.destination.symlink(target, to, {
		signal: ctx.signal,
		timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
	});
	let result: FileInfo;
	try {
		result = await ctx.destination.stat({
			path: to,
			timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
			signal: ctx.signal,
			followLinks: false,
		});
		if (result.kind !== 'symlink' || (await ctx.destination.readlink(options(ctx, to))) !== target) {
			throw new RemoteFileFailure('operation_unknown');
		}
	} catch (cause) {
		throw new RemoteFileFailure('operation_unknown', { cause });
	}
	ctx.completedFiles++;
	ctx.completedSources.push({ path: from, info, linkTarget: target });
	reportProgress(ctx, from);
	return { path: to, name: path.posix.basename(to), info: result };
}

async function copyOne(ctx: CopyContext, from: string, to: string, scannedInfo?: FileInfo): Promise<FilePathEntry> {
	ctx.signal.throwIfAborted();
	// READDIR already provides lstat metadata for each child. Reuse that
	// observation; a second lstat is another race, not a file snapshot.
	// Move still revalidates every source before beginning deletion.
	const info =
		scannedInfo ??
		(await ctx.source.stat({
			path: from,
			timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
			signal: ctx.signal,
			followLinks: false,
		}));
	if (info.kind === 'file') {
		return copyOneFile(ctx, from, to, info);
	}
	if (info.kind === 'symlink') {
		return copyOneLink(ctx, from, to, info);
	}
	if (info.kind !== 'directory') {
		throw new RemoteFileFailure('invalid_input');
	}
	const existing = await optionalStat(ctx.destination, ctx, to);
	if (existing !== null && existing.kind !== 'directory') {
		throw new RemoteFileFailure('conflict');
	}
	await mkdirParents(ctx, path.posix.dirname(to));
	if (existing === null) {
		ctx.mutationStarted = true;
		ctx.onMutation();
		await ctx.destination.mkdir(options(ctx, to));
	}
	const entries: FileEntry[] = await ctx.source.scan({
		path: from,
		timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
		signal: ctx.signal,
	});
	for (const entry of entries) {
		if (entry.name === '.' || entry.name === '..' || entry.name.includes('/')) {
			throw new RemoteFileFailure('invalid_input');
		}
		await copyOne(ctx, path.posix.join(from, entry.name), path.posix.join(to, entry.name), entry.info);
	}
	// SFTP mkdir obeys remote umask; restore the source permissions after
	// creating children rather than reporting a directory with changed mode.
	ctx.mutationStarted = true;
	ctx.onMutation();
	await ctx.destination.chmod({
		path: to,
		timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
		signal: ctx.signal,
		mode: info.mode & 0o7777,
	});
	await ctx.destination.utimes({
		path: to,
		timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
		signal: ctx.signal,
		accessedAt: info.accessedAt,
		modifiedAt: info.modifiedAt,
	});
	ctx.completedSources.push({ path: from, info });
	const destinationInfo = await ctx.destination.stat({
		path: to,
		timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
		signal: ctx.signal,
		followLinks: false,
	});
	if (
		destinationInfo.kind !== 'directory' ||
		(destinationInfo.mode & 0o7777) !== (info.mode & 0o7777) ||
		destinationInfo.modifiedAt !== info.modifiedAt
	) {
		throw new RemoteFileFailure('operation_unknown');
	}
	return { path: to, name: path.posix.basename(to), info: destinationInfo };
}

/** Capture deletion candidates only for moves; copy traversal belongs to rsync. */
async function rememberMoveSource(
	ctx: CopyContext,
	from: string,
	info: FileInfo,
): Promise<CopyContext['completedSources']> {
	const entries: CopyContext['completedSources'] = [];
	if (info.kind === 'directory') {
		for (const entry of await ctx.source.scan(options(ctx, from))) {
			if (entry.name === '.' || entry.name === '..' || entry.name.includes('/')) {
				throw new RemoteFileFailure('invalid_input');
			}
			for (const item of await rememberMoveSource(ctx, path.posix.join(from, entry.name), entry.info)) {
				entries.push(item);
			}
		}
	}
	if (info.kind === 'other') {
		throw new RemoteFileFailure('invalid_input');
	}
	const linkTarget = info.kind === 'symlink' ? await ctx.source.readlink(options(ctx, from)) : undefined;
	entries.push({ path: from, info, ...(linkTarget === undefined ? {} : { linkTarget }) });
	return entries;
}

async function copyDirectRoot(
	ctx: CopyContext,
	from: string,
	to: string,
	info: FileInfo,
	mode: 'copy' | 'move',
	direct: FileDirectCopy,
): Promise<FilePathEntry | null> {
	const existing = await optionalStat(ctx.destination, ctx, to);
	if (existing !== null && existing.kind !== info.kind) {
		throw new RemoteFileFailure('conflict');
	}
	if (info.kind === 'other') {
		throw new RemoteFileFailure('invalid_input');
	}
	const linkTarget = info.kind === 'symlink' ? await ctx.source.readlink(options(ctx, from)) : undefined;
	const sources = mode === 'move' ? await rememberMoveSource(ctx, from, info) : [];
	const before = ctx.transferredBytes;
	const transferred = await direct(
		from,
		info.kind === 'directory',
		(bytes) => {
			ctx.transferredBytes = Math.max(ctx.transferredBytes, before + bytes);
			reportProgress(ctx, from);
		},
		() => {
			ctx.mutationStarted = true;
			ctx.onMutation();
		},
	);
	if (!transferred) {
		return null;
	}
	ctx.remaining();
	const result = await ctx.destination.stat({
		path: to,
		timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
		signal: ctx.signal,
		followLinks: false,
	});
	if (
		result.kind !== info.kind ||
		(info.kind === 'file' && result.size !== info.size) ||
		(result.mode & 0o7777) !== (info.mode & 0o7777) ||
		result.modifiedAt !== info.modifiedAt ||
		(linkTarget !== undefined && (await ctx.destination.readlink(options(ctx, to))) !== linkTarget)
	) {
		throw new RemoteFileFailure('operation_unknown');
	}
	if (info.kind === 'file') {
		ctx.transferredBytes = Math.max(ctx.transferredBytes, before + info.size);
	}
	ctx.completedFiles++;
	for (const item of sources) {
		ctx.completedSources.push(item);
	}
	reportProgress(ctx, from);
	return { path: to, name: path.posix.basename(to), info: result };
}

/** Metadata is a change detector, not an atomic snapshot or conditional unlink. */
async function validateMoveSource(
	ctx: CopyContext,
	item: CopyContext['completedSources'][number],
	checkDirectoryMetadata: boolean,
): Promise<void> {
	const current = await optionalStat(ctx.source, ctx, item.path);
	if (
		current === null ||
		current.kind !== item.info.kind ||
		current.mode !== item.info.mode ||
		((current.kind !== 'directory' || checkDirectoryMetadata) &&
			(current.size !== item.info.size || current.modifiedAt !== item.info.modifiedAt)) ||
		(item.linkTarget !== undefined && (await ctx.source.readlink(options(ctx, item.path))) !== item.linkTarget)
	) {
		throw new RemoteFileFailure('conflict');
	}
}

/**
 * Application copy/move workflow shared by cross-Workspace and same-Workspace
 * tasks. The calling Service owns admission and authorization; this helper
 * owns the batch plan, publication and source-deletion policy.
 */
export async function copyRemoteEntries(
	source: FileResource,
	destination: FileResource,
	paths: readonly string[],
	destinationDirectory: string,
	mode: 'copy' | 'move',
	remaining: () => number,
	signal: AbortSignal,
	onProgress: (progress: CopyProgress) => void,
	onMutation: () => void,
	direct: FileDirectCopy,
): Promise<{ items: FilePathEntry[]; transferredBytes: number; completedFiles: number }> {
	let directTransfer: FileDirectCopy | undefined = direct;
	const sameTarget = source.targetId === destination.targetId && source.fingerprint === destination.fingerprint;
	const ctx: CopyContext = {
		source,
		destination,
		remaining,
		signal,
		onProgress,
		transferredBytes: 0,
		completedFiles: 0,
		totalBytes: 0,
		totalFiles: paths.length,
		totalKnown: false,
		mutationStarted: false,
		onMutation,
		completedSources: [],
	};
	try {
		// Resolve parents, preserving symlink leaf objects. Textually different
		// source aliases must not conceal a target that overwrites a later source.
		const sourceLocations = sameTarget
			? await Promise.all(
					paths.map(async (sourcePath) => {
						const parent = await source.realpath(options(ctx, path.posix.dirname(sourcePath)));
						return path.posix.join(parent, path.posix.basename(sourcePath));
					}),
				)
			: paths;
		const destinationRoot = sameTarget
			? await destinationLocation(ctx, destinationDirectory)
			: destinationDirectory;
		const nestedSources = sourceLocations.some((input, index) =>
			sourceLocations.some((other, otherIndex) => index !== otherIndex && input.startsWith(other + '/')),
		);
		if (nestedSources) {
			throw new RemoteFileFailure('conflict');
		}
		// Reject ambiguous batch plans before the first remote mkdir. The old
		// loop could copy two same-basename inputs onto one destination or move
		// a parent and then fail to remove its already-moved child.
		const targets = new Set<string>();
		for (const sourcePath of paths) {
			const destinationPath = path.posix.join(destinationDirectory, path.posix.basename(sourcePath));
			const targetLocation = path.posix.join(destinationRoot, path.posix.basename(sourcePath));
			if (targets.has(destinationPath)) {
				throw new RemoteFileFailure('conflict');
			}
			targets.add(destinationPath);
			const overlapsSource = sourceLocations.some(
				(input) =>
					targetLocation === input ||
					targetLocation.startsWith(input + '/') ||
					input.startsWith(targetLocation + '/'),
			);
			const unchangedMove = mode === 'move' && destinationPath === sourcePath;
			if (sameTarget && overlapsSource && !unchangedMove) {
				throw new RemoteFileFailure('conflict');
			}
		}
		// Selected file roots have exact totals without a recursive pre-scan.
		const roots = new Map<string, FileInfo>();
		if (!(sameTarget && mode === 'move')) {
			ctx.totalKnown = true;
			for (const sourcePath of paths) {
				const info = await source.stat({
					path: sourcePath,
					timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
					signal,
					followLinks: false,
				});
				roots.set(sourcePath, info);
				if (info.kind !== 'file' || !Number.isSafeInteger(info.size) || info.size < 0) {
					ctx.totalKnown = false;
				} else {
					ctx.totalBytes += info.size;
					if (!Number.isSafeInteger(ctx.totalBytes)) {
						ctx.totalKnown = false;
					}
				}
			}
		}
		await mkdirParents(ctx, destinationDirectory);
		const items: FilePathEntry[] = [];
		for (const sourcePath of paths) {
			const destinationPath = path.posix.join(destinationDirectory, path.posix.basename(sourcePath));
			if (mode === 'move' && sameTarget) {
				if (destinationPath === sourcePath) {
					// Legacy same-path move was a no-op, not a copy conflict.
					continue;
				}
				if ((await optionalStat(ctx.destination, ctx, destinationPath)) === null) {
					ctx.mutationStarted = true;
					ctx.onMutation();
					await source.rename({
						from: sourcePath,
						to: destinationPath,
						timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
						signal: ctx.signal,
					});
					const info = await destination.stat({
						path: destinationPath,
						timeoutMs: Math.min(ctx.remaining(), RPC_TIMEOUT_MS),
						signal: ctx.signal,
						followLinks: false,
					});
					ctx.completedFiles++;
					reportProgress(ctx, sourcePath);
					items.push({ path: destinationPath, name: path.posix.basename(destinationPath), info });
					continue;
				}
				// Existing files/directories use the verified copy/merge and source
				// deletion workflow; ordinary SFTP rename cannot overwrite or merge.
			}
			const rootInfo = roots.get(sourcePath);
			let copied: FilePathEntry | null = null;
			if (directTransfer && !sameTarget && rootInfo) {
				copied = await copyDirectRoot(ctx, sourcePath, destinationPath, rootInfo, mode, directTransfer);
				// Probe unreachable peers once per task, then relay later roots.
				if (copied === null) {
					directTransfer = undefined;
				}
			}
			items.push(copied ?? (await copyOne(ctx, sourcePath, destinationPath, rootInfo)));
		}
		if (mode === 'move') {
			for (const item of ctx.completedSources) {
				await validateMoveSource(ctx, item, true);
			}
			// Source deletion only begins after all destination entries are
			// confirmed; a failure after this point cannot mean rollback.
			for (const sourceItem of ctx.completedSources) {
				// Deleting children changes directory metadata; rmdir still refuses new children.
				await validateMoveSource(ctx, sourceItem, false);
				ctx.mutationStarted = true;
				ctx.onMutation();
				if (sourceItem.info.kind === 'directory') {
					await source.rmdir(options(ctx, sourceItem.path));
				} else {
					await source.remove(options(ctx, sourceItem.path));
				}
			}
		}
		return { items, transferredBytes: ctx.transferredBytes, completedFiles: ctx.completedFiles };
	} catch (cause) {
		// A multi-entry task may have created destinations or removed sources.
		// Preserve definite pre-dispatch failures, but do not report harmless
		// cancellation after any remote mutation may already have been sent.
		if (ctx.mutationStarted && !(cause instanceof RemoteResourceCleanupFailure)) {
			throw new RemoteFileFailure('operation_unknown', { cause });
		}
		throw cause;
	}
}
