import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isWellFormedFileText } from '@nexus-terminal/shared/remote/files/text-codec';
import {
	REMOTE_FILE_MAX_PATH_BYTES,
	REMOTE_FILE_MAX_LIST_ENTRIES,
	REMOTE_FILE_MAX_METADATA_BYTES,
} from '@nexus-terminal/shared/remote/files/values';
import { RemoteFileFailure } from '../model/file-types.js';
import type { FileInfo } from '../model/file-types.js';
import type {
	ReadTextResult,
	ReadSearchResult,
	FileInspectionContext,
	FileContent,
} from '../../machines/model/operation-types.js';

const MAX_TEXT_BYTES = 32 * 1024;
const MAX_SEARCH_FILES = 100;
const MAX_SEARCH_DIRECTORIES = 100;
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;

export function inspectionPath(input: string): string {
	if (
		!isWellFormedFileText(input) ||
		!input.startsWith('/') ||
		input.includes('\0') ||
		Buffer.byteLength(input, 'utf8') > REMOTE_FILE_MAX_PATH_BYTES ||
		input.split('/').includes('..')
	) {
		throw new RemoteFileFailure('invalid_input');
	}
	return path.posix.resolve(input);
}

export async function inspectInfo(context: FileInspectionContext, input: string): Promise<FileInfo> {
	await context.validate();
	const requested = inspectionPath(input);
	const options = { path: requested, signal: context.signal, timeoutMs: context.remaining() };
	const canonical = await context.resource.realpath(options);
	if (canonical !== requested) {
		throw new RemoteFileFailure('invalid_input');
	}
	const info = await context.resource.stat({
		path: requested,
		signal: context.signal,
		timeoutMs: context.remaining(),
		followLinks: false,
	});
	await context.validate();
	return info;
}

export async function inspectText(context: FileInspectionContext, input: string): Promise<ReadTextResult> {
	const requested = inspectionPath(input);
	const before = await inspectInfo(context, requested);
	if (before.kind !== 'file') {
		throw new RemoteFileFailure('not_text');
	}
	if (before.size > MAX_TEXT_BYTES) {
		throw new RemoteFileFailure('limit_exceeded');
	}
	const bytes = await context.resource.read({
		path: requested,
		maxBytes: MAX_TEXT_BYTES,
		timeoutMs: context.remaining(),
		signal: context.signal,
	});
	const after = await inspectInfo(context, requested);
	if (
		after.kind !== 'file' ||
		before.size !== after.size ||
		before.modifiedAt !== after.modifiedAt ||
		bytes.byteLength !== after.size
	) {
		throw new RemoteFileFailure('conflict');
	}
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch (cause) {
		throw new RemoteFileFailure('not_text', { cause });
	}
	if (text.includes('\0')) {
		throw new RemoteFileFailure('not_text');
	}
	return { path: requested, text, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function inspectDirectory(context: FileInspectionContext, input: string) {
	const requested = inspectionPath(input);
	const info = await inspectInfo(context, requested);
	if (info.kind !== 'directory') {
		throw new RemoteFileFailure('invalid_input');
	}
	const entries = await context.resource.list({
		path: requested,
		maxEntries: REMOTE_FILE_MAX_LIST_ENTRIES,
		maxMetadataBytes: REMOTE_FILE_MAX_METADATA_BYTES,
		timeoutMs: context.remaining(),
		signal: context.signal,
	});
	await context.validate();
	for (const entry of entries) {
		if (
			entry.name === '.' ||
			entry.name === '..' ||
			entry.name.includes('/') ||
			entry.name.includes('\0') ||
			!isWellFormedFileText(entry.name)
		) {
			throw new RemoteFileFailure('invalid_input');
		}
	}
	return entries;
}

/** Literal content search deliberately avoids model-supplied regular expressions. */
export async function inspectSearch(
	context: FileInspectionContext,
	root: string,
	query: string,
	maxResults: number,
): Promise<ReadSearchResult> {
	if (
		!isWellFormedFileText(query) ||
		!query ||
		query.includes('\n') ||
		query.includes('\r') ||
		Buffer.byteLength(query, 'utf8') > 1024 ||
		!Number.isSafeInteger(maxResults) ||
		maxResults < 1 ||
		maxResults > 100
	) {
		throw new RemoteFileFailure('invalid_input');
	}
	const normalized = inspectionPath(root);
	const initial = await inspectInfo(context, normalized);
	if (initial.kind !== 'file' && initial.kind !== 'directory') {
		throw new RemoteFileFailure('invalid_input');
	}
	const queue = [{ path: normalized, kind: initial.kind, depth: 0 }];
	const matches: ReadSearchResult['matches'] = [];
	let fileCount = 0;
	let directoryCount = 0;
	let bytes = 0;
	while (queue.length) {
		const next = queue.shift();
		if (!next) {
			break;
		}
		if (next.depth > 8) {
			throw new RemoteFileFailure('limit_exceeded');
		}
		if (next.kind === 'directory') {
			if (++directoryCount > MAX_SEARCH_DIRECTORIES) {
				throw new RemoteFileFailure('limit_exceeded');
			}
			for (const entry of await inspectDirectory(context, next.path)) {
				if (entry.info.kind === 'file' || entry.info.kind === 'directory') {
					if (queue.length + fileCount + directoryCount >= MAX_SEARCH_FILES + MAX_SEARCH_DIRECTORIES) {
						throw new RemoteFileFailure('limit_exceeded');
					}
					queue.push({
						path: path.posix.join(next.path, entry.name),
						kind: entry.info.kind,
						depth: next.depth + 1,
					});
				}
			}
			continue;
		}
		if (++fileCount > MAX_SEARCH_FILES) {
			throw new RemoteFileFailure('limit_exceeded');
		}
		let file: ReadTextResult;
		try {
			file = await inspectText(context, next.path);
		} catch (error) {
			if (error instanceof RemoteFileFailure && error.code === 'not_text') {
				continue;
			}
			throw error;
		}
		bytes += file.bytes;
		if (bytes > MAX_SEARCH_BYTES) {
			throw new RemoteFileFailure('limit_exceeded');
		}
		const lines = file.text.split(/\r\n|\n|\r/u);
		for (let index = 0; index < lines.length; index++) {
			const column = lines[index].indexOf(query);
			if (column < 0) {
				continue;
			}
			if (matches.length === maxResults) {
				return { matches, truncated: true };
			}
			matches.push({ path: file.path, line: index + 1, column: column + 1, text: lines[index] });
		}
	}
	return { matches, truncated: false };
}

/** Keep the resource with its owner until the consumer and EOF checks have settled. */
export async function consumeInspectedFile<T>(
	context: FileInspectionContext,
	input: string,
	maxBytes: number,
	consume: (file: FileContent, source: AsyncIterable<Uint8Array>) => Promise<T>,
): Promise<T> {
	const requested = inspectionPath(input);
	const before = await inspectInfo(context, requested);
	if (before.kind !== 'file') {
		throw new RemoteFileFailure('invalid_input');
	}
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || before.size > maxBytes) {
		throw new RemoteFileFailure('limit_exceeded');
	}
	let completed = false;
	let sourceFailure: unknown = null;

	async function* source(): AsyncGenerator<Uint8Array, void, void> {
		try {
			let size = 0;
			if (before.size > 0) {
				const bytes = await context.resource.openRead({
					path: requested,
					maxBytes: before.size,
					timeoutMs: context.remaining(),
					signal: context.signal,
				});
				for await (const chunk of bytes) {
					await context.validate();
					if (chunk.byteLength > before.size - size) {
						throw new RemoteFileFailure('conflict');
					}
					size += chunk.byteLength;
					yield chunk;
				}
			}
			const after = await inspectInfo(context, requested);
			if (
				after.kind !== 'file' ||
				size !== before.size ||
				after.size !== before.size ||
				after.modifiedAt !== before.modifiedAt
			) {
				throw new RemoteFileFailure('conflict');
			}
			await context.validate();
			completed = true;
		} catch (error) {
			sourceFailure = error;
			throw error;
		}
	}

	const content = source();
	let failure: unknown = null;
	try {
		const result = await consume(
			{ path: requested, name: path.posix.basename(requested), sizeBytes: before.size },
			content,
		);
		if (!completed) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		return result;
	} catch (error) {
		failure = error;
		// The importing consumer can wrap a byte-source error; the original resource
		// owner must still retain unconfirmed SSH cleanup independently of that wrapper.
		if (sourceFailure instanceof RemoteResourceCleanupFailure) {
			failure = new RemoteResourceCleanupFailure(sourceFailure === error ? [error] : [sourceFailure, error]);
		}
		throw failure;
	} finally {
		try {
			await content.return();
		} catch (cleanup) {
			throw new RemoteResourceCleanupFailure(failure === null ? [cleanup] : [failure, cleanup]);
		}
	}
}
