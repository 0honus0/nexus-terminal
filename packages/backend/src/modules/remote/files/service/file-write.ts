import path from 'node:path';
import { createHash } from 'node:crypto';
import { isWellFormedFileText } from '@nexus-terminal/shared/remote/files/text-codec';
import { RemoteFileFailure } from '../model/file-types.js';
import type { FileInfo, FileStagedWrite } from '../model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { inspectionPath, inspectInfo, inspectText } from './file-inspection.js';
import type { FileInspectionContext, WriteTextRequest, WriteTextResult } from '../../machines/model/operation-types.js';

async function precondition(
	context: FileInspectionContext,
	filePath: string,
	expected: string,
): Promise<FileInfo | null> {
	const parent = await inspectInfo(context, path.posix.dirname(filePath));
	if (parent.kind !== 'directory') {
		throw new RemoteFileFailure('invalid_input');
	}
	let info: FileInfo;
	try {
		info = await context.resource.stat({
			path: filePath,
			followLinks: false,
			signal: context.signal,
			timeoutMs: context.remaining(),
		});
	} catch (error) {
		if (error instanceof RemoteFileFailure && error.code === 'not_found' && expected === 'absent') {
			await context.validate();
			return null;
		}
		throw error;
	}
	if (expected === 'absent' || info.kind !== 'file') {
		throw new RemoteFileFailure('conflict');
	}
	const current = await inspectText(context, filePath);
	if (current.sha256 !== expected) {
		throw new RemoteFileFailure('conflict');
	}
	return info;
}

/** Prechecks reduce stale writes; SFTP does not provide a content-hash compare-and-swap. */
export async function writeInspectedText(
	context: FileInspectionContext,
	input: WriteTextRequest,
): Promise<WriteTextResult> {
	const filePath = inspectionPath(input.path);
	if (
		filePath === '/' ||
		!isWellFormedFileText(input.content) ||
		input.content.includes('\0') ||
		Buffer.byteLength(input.content, 'utf8') > 32 * 1024 ||
		(input.expectedSha256 !== 'absent' && !/^[a-f0-9]{64}$/.test(input.expectedSha256))
	) {
		throw new RemoteFileFailure('invalid_input');
	}
	const bytes = Buffer.from(input.content, 'utf8');
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const before = await precondition(context, filePath, input.expectedSha256);
	await context.validate();
	let staged: FileStagedWrite | null = null;
	let failure: unknown = null;
	try {
		// Even a failed temporary write may have changed the remote filesystem.
		staged = await context.resource.stage({
			path: filePath,
			bytes,
			mode: before === null ? 0o600 : before.mode & 0o777,
			signal: context.signal,
			timeoutMs: context.remaining(),
		});
		const current = await precondition(context, filePath, input.expectedSha256);
		if (before !== null && current !== null && before.mode !== current.mode) {
			throw new RemoteFileFailure('conflict');
		}
		await context.validate();
		await staged.commit(before === null ? 'create' : 'replace');
		const confirmed = await inspectText(context, filePath);
		if (confirmed.sha256 !== sha256 || confirmed.bytes !== bytes.length) {
			throw new RemoteFileFailure('conflict');
		}
		await context.validate();
		return { path: filePath, status: before === null ? 'created' : 'replaced', bytes: bytes.length, sha256 };
	} catch (cause) {
		failure =
			cause instanceof RemoteResourceCleanupFailure
				? cause
				: new RemoteFileFailure('operation_unknown', { cause });
		throw failure;
	} finally {
		if (staged) {
			try {
				await staged.discard();
			} catch (cleanup) {
				throw new RemoteResourceCleanupFailure(failure === null ? [cleanup] : [failure, cleanup]);
			}
		}
	}
}
