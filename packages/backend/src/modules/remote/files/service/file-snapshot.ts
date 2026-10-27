import path from 'node:path';
import { createHash } from 'node:crypto';
import { RemoteFileFailure } from '../model/file-types.js';
import type { FileInfo, FileSnapshotNode, FileTreeSnapshot } from '../model/file-types.js';
import type { FileInspectionContext } from '../../machines/model/operation-types.js';
import { inspectionPath, inspectInfo, inspectDirectory } from './file-inspection.js';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TREE_BYTES = 2 * 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;

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
	maxBytes = MAX_FILE_BYTES,
): Promise<FileSnapshotNode> {
	const filePath = inspectionPath(path.posix.join(root, relativePath));
	const before = await inspectInfo(context, filePath);
	if (before.kind !== 'file') {
		throw new RemoteFileFailure('conflict');
	}
	if (before.size > Math.min(MAX_FILE_BYTES, maxBytes)) {
		throw new RemoteFileFailure('limit_exceeded');
	}
	const bytes = await context.resource.read({
		path: filePath,
		maxBytes: Math.min(MAX_FILE_BYTES, maxBytes),
		length: before.size,
		signal: context.signal,
		timeoutMs: context.remaining(),
	});
	const after = await inspectInfo(context, filePath);
	if (!sameFileInfo(before, after) || bytes.byteLength !== before.size) {
		throw new RemoteFileFailure('conflict');
	}
	return { relativePath, kind: 'file', info: after, contentSha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Bounded captured facts, not a filesystem snapshot or a cross-call lock. */
export async function capturePath(context: FileInspectionContext, input: string): Promise<FileTreeSnapshot> {
	const root = inspectionPath(input);
	const initial = await inspectInfo(context, root);
	if (initial.kind !== 'file' && initial.kind !== 'directory') {
		throw new RemoteFileFailure('invalid_input');
	}
	const queue = [{ relativePath: '', kind: initial.kind, depth: 0 }];
	const nodes: FileSnapshotNode[] = [];
	const paths = new Set(['']);
	let fileCount = initial.kind === 'file' ? 1 : 0;
	let directoryCount = initial.kind === 'directory' ? 1 : 0;
	let bytes = 0;
	let metadataBytes = 0;
	while (queue.length) {
		const next = queue.shift();
		if (!next) {
			break;
		}
		if (next.depth > 8) {
			throw new RemoteFileFailure('limit_exceeded');
		}
		const currentPath = inspectionPath(path.posix.join(root, next.relativePath));
		let node: FileSnapshotNode;
		if (next.kind === 'file') {
			node = await captureFileNode(context, root, next.relativePath, MAX_TREE_BYTES - bytes);
			bytes += node.info.size;
			if (bytes > MAX_TREE_BYTES) {
				throw new RemoteFileFailure('limit_exceeded');
			}
		} else {
			const before = await inspectInfo(context, currentPath);
			if (before.kind !== 'directory') {
				throw new RemoteFileFailure('conflict');
			}
			for (const entry of await inspectDirectory(context, currentPath)) {
				if (entry.info.kind !== 'file' && entry.info.kind !== 'directory') {
					throw new RemoteFileFailure('invalid_input');
				}
				if (entry.info.kind === 'file') {
					fileCount++;
				} else {
					directoryCount++;
				}
				if (fileCount > 100 || directoryCount > 100 || next.depth >= 8) {
					throw new RemoteFileFailure('limit_exceeded');
				}
				const relativePath = path.posix.join(next.relativePath, entry.name);
				if (paths.has(relativePath)) {
					throw new RemoteFileFailure('conflict');
				}
				paths.add(relativePath);
				queue.push({
					relativePath,
					kind: entry.info.kind,
					depth: next.depth + 1,
				});
			}
			const after = await inspectInfo(context, currentPath);
			if (!sameFileInfo(before, after)) {
				throw new RemoteFileFailure('conflict');
			}
			node = { relativePath: next.relativePath, kind: 'directory', info: after, contentSha256: null };
		}
		metadataBytes += Buffer.byteLength(JSON.stringify(node), 'utf8');
		if (metadataBytes > MAX_METADATA_BYTES) {
			throw new RemoteFileFailure('limit_exceeded');
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
	const facts = nodes.map((node) => [
		node.relativePath,
		node.kind,
		node.info.size,
		node.info.mode,
		node.info.uid,
		node.info.gid,
		node.info.modifiedAt,
		node.contentSha256,
	]);
	const fingerprint = createHash('sha256').update(JSON.stringify(facts), 'utf8').digest('hex');
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
