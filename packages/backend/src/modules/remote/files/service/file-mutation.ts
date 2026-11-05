import path from 'node:path';
import { isWellFormedFileText } from '@nexus-terminal/shared/remote/files/text-codec';
import { RemoteFileFailure } from '../model/file-types.js';
import type {
	FileInspectionContext,
	PatchTextRequest,
	MovePathRequest,
	MovePathResult,
	DeletePathRequest,
	DeletePathResult,
	WriteTextResult,
} from '../../machines/model/operation-types.js';
import { inspectionPath, inspectInfo, inspectText } from './file-inspection.js';
import { capturePath, captureFileNode, sameFileInfo, requireMissingPath } from './file-snapshot.js';
import { writeInspectedText } from './file-write.js';

function mutationPath(value: string): string {
	const normalized = inspectionPath(value);
	if (normalized === '/') {
		throw new RemoteFileFailure('invalid_input');
	}
	return normalized;
}

function fingerprint(value: string): void {
	if (!/^[a-f0-9]{64}$/.test(value)) {
		throw new RemoteFileFailure('invalid_input');
	}
}

export async function patchInspectedText(
	context: FileInspectionContext,
	input: PatchTextRequest,
): Promise<WriteTextResult> {
	const filePath = mutationPath(input.path);
	fingerprint(input.expectedSha256);
	if (!input.edits.length) {
		throw new RemoteFileFailure('invalid_input');
	}
	for (const edit of input.edits) {
		if (
			!edit.oldText ||
			edit.oldText === edit.newText ||
			!isWellFormedFileText(edit.oldText) ||
			!isWellFormedFileText(edit.newText) ||
			edit.oldText.includes('\0') ||
			edit.newText.includes('\0') ||
			Buffer.byteLength(edit.oldText, 'utf8') > 4096 ||
			Buffer.byteLength(edit.newText, 'utf8') > 4096
		) {
			throw new RemoteFileFailure('invalid_input');
		}
	}
	const before = await inspectText(context, filePath);
	if (before.sha256 !== input.expectedSha256) {
		throw new RemoteFileFailure('conflict');
	}
	const changes = input.edits
		.map((edit) => {
			const start = before.text.indexOf(edit.oldText);
			if (start < 0 || before.text.indexOf(edit.oldText, start + 1) !== -1) {
				throw new RemoteFileFailure('conflict');
			}
			return { start, end: start + edit.oldText.length, replacement: edit.newText };
		})
		.sort((left, right) => left.start - right.start);
	for (let index = 1; index < changes.length; index++) {
		if (changes[index].start < changes[index - 1].end) {
			throw new RemoteFileFailure('conflict');
		}
	}
	let offset = 0;
	const fragments: string[] = [];
	for (const change of changes) {
		fragments.push(before.text.slice(offset, change.start), change.replacement);
		offset = change.end;
	}
	fragments.push(before.text.slice(offset));
	const content = fragments.join('');
	if (Buffer.byteLength(content, 'utf8') > 32 * 1024) {
		throw new RemoteFileFailure('limit_exceeded');
	}
	return writeInspectedText(context, { path: filePath, content, expectedSha256: input.expectedSha256 });
}

export async function moveInspectedPath(
	context: FileInspectionContext,
	input: MovePathRequest,
): Promise<MovePathResult> {
	const source = mutationPath(input.path);
	const destination = mutationPath(input.destinationPath);
	fingerprint(input.expectedFingerprint);
	if (source === destination || destination.startsWith(source + '/') || source.startsWith(destination + '/')) {
		throw new RemoteFileFailure('invalid_input');
	}
	const before = await capturePath(context, source);
	if (before.fingerprint !== input.expectedFingerprint) {
		throw new RemoteFileFailure('conflict');
	}
	await requireMissingPath(context, destination);
	await context.validate();
	try {
		await context.resource.rename({
			from: source,
			to: destination,
			signal: context.signal,
			timeoutMs: context.remaining(),
		});
		await requireMissingPath(context, source);
		const after = await capturePath(context, destination);
		if (after.fingerprint !== before.fingerprint || after.kind !== before.kind) {
			throw new RemoteFileFailure('conflict');
		}
		await context.validate();
		return { path: source, destinationPath: destination, kind: before.kind, fingerprint: after.fingerprint };
	} catch (cause) {
		throw new RemoteFileFailure('operation_unknown', { cause });
	}
}

export async function deleteInspectedPath(
	context: FileInspectionContext,
	input: DeletePathRequest,
): Promise<DeletePathResult> {
	const root = mutationPath(input.path);
	fingerprint(input.expectedFingerprint);
	if (input.scope !== 'entry' && input.scope !== 'tree') {
		throw new RemoteFileFailure('invalid_input');
	}
	const before = await capturePath(context, root);
	if (before.fingerprint !== input.expectedFingerprint || (input.scope === 'entry' && before.nodes.length !== 1)) {
		throw new RemoteFileFailure('conflict');
	}
	const plan = before.nodes
		.slice()
		.sort(
			(left, right) =>
				right.relativePath.split('/').length - left.relativePath.split('/').length ||
				right.relativePath.length - left.relativePath.length,
		);
	let started = false;
	try {
		for (const node of plan) {
			const currentPath = inspectionPath(path.posix.join(root, node.relativePath));
			if (node.kind === 'file') {
				const current = await captureFileNode(context, root, node.relativePath);
				if (current.contentSha256 !== node.contentSha256 || !sameFileInfo(current.info, node.info)) {
					throw new RemoteFileFailure('conflict');
				}
			} else {
				const current = await inspectInfo(context, currentPath);
				// Removing our own children changes size/mtime; retain kind, ownership and mode checks.
				if (
					current.kind !== 'directory' ||
					current.mode !== node.info.mode ||
					current.uid !== node.info.uid ||
					current.gid !== node.info.gid
				) {
					throw new RemoteFileFailure('conflict');
				}
				const entries = await context.resource.list({
					path: currentPath,
					maxEntries: 1,
					maxMetadataBytes: 4096,
					signal: context.signal,
					timeoutMs: context.remaining(),
				});
				if (entries.length) {
					throw new RemoteFileFailure('conflict');
				}
			}
			await context.validate();
			started = true;
			const request = { path: currentPath, signal: context.signal, timeoutMs: context.remaining() };
			if (node.kind === 'file') {
				await context.resource.remove(request);
			} else {
				await context.resource.rmdir(request);
			}
			await requireMissingPath(context, currentPath);
		}
		await context.validate();
		return { path: root, kind: before.kind, fileCount: before.fileCount, directoryCount: before.directoryCount };
	} catch (cause) {
		if (!started) {
			throw cause;
		}
		throw new RemoteFileFailure('operation_unknown', { cause });
	}
}
