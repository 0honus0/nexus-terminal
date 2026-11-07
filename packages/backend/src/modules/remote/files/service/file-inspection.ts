import type {
	ReadTextPageRequest,
	ReadTextPageResult,
	ReadDirectoryPageRequest,
	ReadDirectoryPageResult,
} from '../../machines/model/operation-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { constants as bufferConstants } from 'node:buffer';
import { isWellFormedFileText } from '@nexus-terminal/shared/remote/files/text-codec';
import {
	REMOTE_FILE_MAX_PATH_BYTES,
	REMOTE_FILE_MAX_LIST_ENTRIES,
	REMOTE_FILE_MAX_METADATA_BYTES,
	REMOTE_FILE_TEXT_PAGE_MIN_BYTES,
	REMOTE_FILE_TEXT_PAGE_MAX_BYTES,
} from '@nexus-terminal/shared/remote/files/values';
import { RemoteFileFailure } from '../model/file-types.js';
import type { FileInfo } from '../model/file-types.js';
import type {
	ReadTextResult,
	ReadSearchResult,
	FileInspectionContext,
	FileContent,
} from '../../machines/model/operation-types.js';

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
	// Full-text edits are buffered strings; pagination capacity is not a file-size policy.
	if (before.size > bufferConstants.MAX_STRING_LENGTH) {
		throw new RemoteFileFailure('limit_exceeded');
	}
	const bytes = await context.resource.read({
		path: requested,
		maxBytes: Math.max(1, before.size),
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

/** Directory pages keep I/O bounded without limiting the complete tree to one page. */
export async function* inspectDirectoryEntries(context: FileInspectionContext, input: string) {
	const requested = inspectionPath(input);
	const before = await inspectInfo(context, requested);
	if (before.kind !== 'directory') {
		throw new RemoteFileFailure('invalid_input');
	}
	let after = '';
	for (;;) {
		const entries = await context.resource.listAfter({
			path: requested,
			after,
			maxEntries: REMOTE_FILE_MAX_LIST_ENTRIES,
			maxMetadataBytes: REMOTE_FILE_MAX_METADATA_BYTES,
			timeoutMs: context.remaining(),
			signal: context.signal,
		});
		await context.validate();
		for (const entry of entries) {
			if (
				entry.name <= after ||
				entry.name.includes('/') ||
				entry.name.includes('\0') ||
				!isWellFormedFileText(entry.name) ||
				entry.name === '.' ||
				entry.name === '..'
			) {
				throw new RemoteFileFailure('invalid_input');
			}
			after = entry.name;
			yield entry;
		}
		if (entries.length === 0) {
			break;
		}
	}
	const current = await inspectInfo(context, requested);
	if (metadataFingerprint(current) !== metadataFingerprint(before)) {
		throw new RemoteFileFailure('conflict');
	}
}

function metadataFingerprint(info: FileInfo): string {
	return createHash('sha256')
		.update(JSON.stringify([info.kind, info.size, info.modifiedAt, info.mode]))
		.digest('hex');
}

export async function inspectTextPage(
	context: FileInspectionContext,
	input: ReadTextPageRequest,
): Promise<ReadTextPageResult> {
	const requested = inspectionPath(input.path);
	if (
		!Number.isSafeInteger(input.offset) ||
		input.offset < 0 ||
		!Number.isSafeInteger(input.maxBytes) ||
		input.maxBytes < REMOTE_FILE_TEXT_PAGE_MIN_BYTES ||
		input.maxBytes > REMOTE_FILE_TEXT_PAGE_MAX_BYTES
	) {
		throw new RemoteFileFailure('invalid_input');
	}
	const before = await inspectInfo(context, requested);
	if (before.kind !== 'file') {
		throw new RemoteFileFailure('not_text');
	}
	if (input.offset > before.size) {
		throw new RemoteFileFailure('invalid_input');
	}
	const length = Math.min(input.maxBytes, before.size - input.offset);
	const bytes = length
		? await context.resource.read({
				path: requested,
				start: input.offset,
				length,
				maxBytes: REMOTE_FILE_TEXT_PAGE_MAX_BYTES,
				timeoutMs: context.remaining(),
				signal: context.signal,
			})
		: new Uint8Array();
	const after = await inspectInfo(context, requested);
	if (metadataFingerprint(after) !== metadataFingerprint(before) || bytes.byteLength !== length) {
		throw new RemoteFileFailure('conflict');
	}
	let text: string;
	try {
		const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
		text = decoder.decode(bytes, { stream: input.offset + length < before.size });
	} catch (cause) {
		throw new RemoteFileFailure('not_text', { cause });
	}
	if (text.includes('\0')) {
		throw new RemoteFileFailure('not_text');
	}
	const used = Buffer.byteLength(text);
	const next = input.offset + used;
	const pageSha256 = createHash('sha256').update(text).digest('hex');
	return {
		path: requested,
		text,
		bytes: used,
		sizeBytes: before.size,
		offset: input.offset,
		nextOffset: next < before.size ? next : null,
		sha256: input.offset === 0 && next === before.size ? pageSha256 : null,
		pageSha256,
		fingerprint: metadataFingerprint(before),
	};
}

export async function inspectDirectoryPage(
	context: FileInspectionContext,
	input: ReadDirectoryPageRequest,
): Promise<ReadDirectoryPageResult> {
	const requested = inspectionPath(input.path);
	if (!isWellFormedFileText(input.after) || input.after.includes('/') || input.after.includes('\0')) {
		throw new RemoteFileFailure('invalid_input');
	}
	const before = await inspectInfo(context, requested);
	if (before.kind !== 'directory') {
		throw new RemoteFileFailure('invalid_input');
	}
	const entries = await context.resource.listAfter({
		path: requested,
		after: input.after,
		maxEntries: REMOTE_FILE_MAX_LIST_ENTRIES + 1,
		maxMetadataBytes: REMOTE_FILE_MAX_METADATA_BYTES,
		timeoutMs: context.remaining(),
		signal: context.signal,
	});
	const after = await inspectInfo(context, requested);
	if (metadataFingerprint(after) !== metadataFingerprint(before)) {
		throw new RemoteFileFailure('conflict');
	}
	if (
		entries.some(
			(entry) => entry.name.includes('/') || entry.name.includes('\0') || !isWellFormedFileText(entry.name),
		)
	) {
		throw new RemoteFileFailure('invalid_input');
	}
	const page = entries.slice(0, REMOTE_FILE_MAX_LIST_ENTRIES);
	return {
		entries: page.map((entry) => ({
			name: entry.name,
			kind: entry.info.kind,
			size: entry.info.size,
			modifiedAt: entry.info.modifiedAt,
		})),
		nextAfter: page.length ? page[page.length - 1].name : null,
		fingerprint: metadataFingerprint(before),
	};
}

/** Literal content search deliberately avoids model-supplied regular expressions. */
export async function inspectSearch(
	context: FileInspectionContext,
	root: string,
	queries: string[],
	maxResults: number,
): Promise<ReadSearchResult> {
	if (
		!queries.length ||
		new Set(queries).size !== queries.length ||
		queries.some(
			(query) => !isWellFormedFileText(query) || !query || query.includes('\n') || query.includes('\r'),
		) ||
		!Number.isSafeInteger(maxResults) ||
		maxResults < 1
	) {
		throw new RemoteFileFailure('invalid_input');
	}

	const normalized = inspectionPath(root);
	const initial = await inspectInfo(context, normalized);
	if (initial.kind !== 'file' && initial.kind !== 'directory') {
		throw new RemoteFileFailure('invalid_input');
	}
	const queue = [{ path: normalized, kind: initial.kind }];
	const matches: ReadSearchResult['matches'] = [];
	while (queue.length) {
		const next = queue.pop();
		if (!next) {
			break;
		}
		if (next.kind === 'directory') {
			for await (const entry of inspectDirectoryEntries(context, next.path)) {
				if (entry.info.kind === 'file' || entry.info.kind === 'directory') {
					queue.push({
						path: path.posix.join(next.path, entry.name),
						kind: entry.info.kind,
					});
				}
			}
			continue;
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
		const lines = file.text.split(/\r\n|\n|\r/u);
		for (let index = 0; index < lines.length; index++) {
			for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
				const column = lines[index].indexOf(queries[queryIndex]);
				if (column < 0) {
					continue;
				}
				if (matches.length === maxResults) {
					return { matches, truncated: true };
				}
				matches.push({ queryIndex, path: file.path, line: index + 1, column: column + 1, text: lines[index] });
			}
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
