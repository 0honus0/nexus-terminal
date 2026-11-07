import path from 'node:path';
import { createHash } from 'node:crypto';
import { RemoteFileFailure } from '../model/file-types.js';
import type { FileInfo, FileSnapshotNode, FileTreeSnapshot } from '../model/file-types.js';
import type { FileInspectionContext } from '../../machines/model/operation-types.js';
import { inspectionPath, inspectInfo, inspectDirectoryEntries } from './file-inspection.js';

export function sameFileInfo(left: FileInfo, right: FileInfo): boolean {
	return (
		left.kind === right.kind &&
		left.size === right.size &&
		left.mode === right.mode &&
		left.uid === right.uid &&
		left.gid === right.gid &&
		left.modifiedAt === right.modifiedAt
	);
}

export async function captureFileNode(
	context: FileInspectionContext,
	root: string,
	relativePath: string,
): Promise<FileSnapshotNode> {
	const filePath = inspectionPath(path.posix.join(root, relativePath));
	const before = await inspectInfo(context, filePath);
	if (before.kind !== 'file') {
		throw new RemoteFileFailure('conflict');
	}
	const hash = createHash('sha256');
	let bytes = 0;
	if (before.size > 0) {
		const source = await context.resource.openRead({
			path: filePath,
			maxBytes: before.size,
			signal: context.signal,
			timeoutMs: context.remaining(),
		});
		for await (const chunk of source) {
			await context.validate();
			if (chunk.byteLength > before.size - bytes) {
				throw new RemoteFileFailure('conflict');
			}
			hash.update(chunk);
			bytes += chunk.byteLength;
		}
	}
	const after = await inspectInfo(context, filePath);
	if (!sameFileInfo(before, after) || bytes !== before.size) {
		throw new RemoteFileFailure('conflict');
	}
	return { relativePath, kind: 'file', info: after, contentSha256: hash.digest('hex') };
}

/** Stream file hashes and directory pages; retained metadata is not a filesystem snapshot or lock. */
export async function capturePath(context: FileInspectionContext, input: string): Promise<FileTreeSnapshot> {
	const root = inspectionPath(input);
	const initial = await inspectInfo(context, root);
	if (initial.kind !== 'file' && initial.kind !== 'directory') {
		throw new RemoteFileFailure('invalid_input');
	}
	const queue = [{ relativePath: '', kind: initial.kind }];
	const nodes: FileSnapshotNode[] = [];
	const paths = new Set(['']);
	let fileCount = initial.kind === 'file' ? 1 : 0;
	let directoryCount = initial.kind === 'directory' ? 1 : 0;
	let bytes = 0;
	while (queue.length) {
		const next = queue.pop();
		if (!next) {
			break;
		}
		const currentPath = inspectionPath(path.posix.join(root, next.relativePath));
		let node: FileSnapshotNode;
		if (next.kind === 'file') {
			node = await captureFileNode(context, root, next.relativePath);
			bytes += node.info.size;
		} else {
			const before = await inspectInfo(context, currentPath);
			if (before.kind !== 'directory') {
				throw new RemoteFileFailure('conflict');
			}
			for await (const entry of inspectDirectoryEntries(context, currentPath)) {
				if (entry.info.kind !== 'file' && entry.info.kind !== 'directory') {
					throw new RemoteFileFailure('invalid_input');
				}
				if (entry.info.kind === 'file') {
					fileCount++;
				} else {
					directoryCount++;
				}
				const relativePath = path.posix.join(next.relativePath, entry.name);
				if (paths.has(relativePath)) {
					throw new RemoteFileFailure('conflict');
				}
				paths.add(relativePath);
				queue.push({
					relativePath,
					kind: entry.info.kind,
				});
			}
			const after = await inspectInfo(context, currentPath);
			if (!sameFileInfo(before, after)) {
				throw new RemoteFileFailure('conflict');
			}
			node = { relativePath: next.relativePath, kind: 'directory', info: after, contentSha256: null };
		}
		nodes.push(node);
	}
	const after = await inspectInfo(context, root);
	if (!sameFileInfo(initial, after)) {
		throw new RemoteFileFailure('conflict');
	}
	nodes.sort((left, right) =>
		left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
	);
	const hash = createHash('sha256').update('[');
	for (const [index, node] of nodes.entries()) {
		if (index > 0) {
			hash.update(',');
		}
		hash.update(
			JSON.stringify([
				node.relativePath,
				node.kind,
				node.info.size,
				node.info.mode,
				node.info.uid,
				node.info.gid,
				node.info.modifiedAt,
				node.contentSha256,
			]),
		);
	}
	const fingerprint = hash.update(']').digest('hex');
	return { path: root, kind: initial.kind, fingerprint, fileCount, directoryCount, bytes, nodes };
}

export async function requireMissingPath(context: FileInspectionContext, input: string): Promise<void> {
	const requested = inspectionPath(input);
	const parent = await inspectInfo(context, path.posix.dirname(requested));
	if (parent.kind !== 'directory') {
		throw new RemoteFileFailure('invalid_input');
	}
	try {
		await context.resource.stat({
			path: requested,
			followLinks: false,
			signal: context.signal,
			timeoutMs: context.remaining(),
		});
	} catch (error) {
		if (error instanceof RemoteFileFailure && error.code === 'not_found') {
			await context.validate();
			return;
		}
		throw error;
	}
	throw new RemoteFileFailure('conflict');
}
