import { createHash } from 'node:crypto';
import type { SqlParameter, SqlRow } from '../worker-types.js';
import type { SnapshotFileReference, SnapshotTable } from '../snapshot-types.js';
import { SnapshotFailure } from '../snapshot-types.js';

export interface SnapshotArchiveFile {
	reference: SnapshotFileReference;
	content: Uint8Array;
}

export interface SnapshotArchive {
	tables: Map<string, SqlRow[]>;
	files: SnapshotArchiveFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== fields.length ||
		fields.some((field) => !Object.hasOwn(value, field))
	) {
		throw new SnapshotFailure('invalid_archive');
	}
	return value;
}

function row(value: unknown, columns: readonly string[]): SqlRow {
	const input = record(value, columns);
	const result: SqlRow = {};
	for (const column of columns) {
		const scalar = input[column];
		if (
			scalar !== null &&
			(typeof scalar === 'string'
				? Buffer.from(scalar, 'utf8').toString('utf8') !== scalar
				: typeof scalar !== 'number' || !Number.isFinite(scalar))
		) {
			throw new SnapshotFailure('invalid_archive');
		}
		result[column] = scalar;
	}
	return result;
}

function tables(value: unknown, definitions: readonly SnapshotTable[], partition: SqlParameter): Map<string, SqlRow[]> {
	if (!Array.isArray(value) || value.length !== definitions.length) {
		throw new SnapshotFailure('invalid_archive');
	}
	const expected = new Map(definitions.map((table) => [table.name, table]));
	const result = new Map<string, SqlRow[]>();
	for (const item of value) {
		const input = record(item, ['name', 'columns', 'rows']);
		const table = typeof input.name === 'string' ? expected.get(input.name) : undefined;
		if (
			!table ||
			result.has(table.name) ||
			!Array.isArray(input.columns) ||
			input.columns.length !== table.columns.length ||
			input.columns.some((column: unknown, index: number) => column !== table.columns[index]) ||
			!Array.isArray(input.rows)
		) {
			throw new SnapshotFailure('invalid_archive');
		}
		const rows = input.rows.map((value: unknown) => row(value, table.columns));
		if (table.partitionColumn) {
			const column = table.partitionColumn;
			if (rows.some((row) => row[column] !== partition && !(table.allowNullPartition && row[column] === null))) {
				throw new SnapshotFailure('invalid_archive');
			}
		}
		result.set(table.name, rows);
	}
	return result;
}

function file(value: unknown, roots: ReadonlySet<string>, maxBytes: number): SnapshotArchiveFile {
	const input = record(value, ['root', 'key', 'bytes', 'sha256', 'base64']);
	if (
		typeof input.root !== 'string' ||
		!roots.has(input.root) ||
		typeof input.key !== 'string' ||
		!/^[a-f0-9-]{36}$/u.test(input.key) ||
		typeof input.bytes !== 'number' ||
		!Number.isSafeInteger(input.bytes) ||
		input.bytes < 0 ||
		input.bytes > maxBytes ||
		typeof input.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(input.sha256) ||
		typeof input.base64 !== 'string' ||
		input.base64.length !== Math.ceil(input.bytes / 3) * 4
	) {
		throw new SnapshotFailure('invalid_archive');
	}
	const content = Buffer.from(input.base64, 'base64');
	try {
		if (
			content.byteLength !== input.bytes ||
			content.toString('base64') !== input.base64 ||
			createHash('sha256').update(content).digest('hex') !== input.sha256
		) {
			throw new SnapshotFailure('invalid_archive');
		}
		return {
			reference: { root: input.root, key: input.key, bytes: input.bytes, sha256: input.sha256 },
			content,
		};
	} catch (error) {
		content.fill(0);
		throw error;
	}
}

/** Latest exact transfer format only. Raw persistent rows stay inside the technical Adapter boundary. */
export function decodeSnapshotArchive(
	bytes: Uint8Array,
	definitions: readonly SnapshotTable[],
	roots: ReadonlySet<string>,
	maxBytes: number,
	schemaSignature: string,
	partition: SqlParameter,
): SnapshotArchive {
	if (bytes.byteLength > maxBytes) {
		throw new SnapshotFailure('limit_exceeded');
	}
	const files: SnapshotArchiveFile[] = [];
	try {
		const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
		const decoded: unknown = JSON.parse(source);
		// The producer emits compact JSON. Reject duplicate keys and noncanonical scalar encodings,
		// which JSON.parse alone would silently normalize before any owner could validate them.
		if (JSON.stringify(decoded) !== source) {
			throw new SnapshotFailure('invalid_archive');
		}
		const input = record(decoded, ['format', 'version', 'schemaSignature', 'tables', 'files']);
		if (
			input.format !== 'registered-snapshot' ||
			input.version !== 1 ||
			input.schemaSignature !== schemaSignature ||
			!Array.isArray(input.files)
		) {
			throw new SnapshotFailure('invalid_archive');
		}
		const rows = tables(input.tables, definitions, partition);
		const identities = new Set<string>();
		let totalBytes = 0;
		for (const value of input.files) {
			const entry = file(value, roots, maxBytes);
			files.push(entry);
			const key = entry.reference.root + '/' + entry.reference.key;
			totalBytes += entry.content.byteLength;
			if (identities.has(key) || totalBytes > maxBytes) {
				throw new SnapshotFailure('invalid_archive');
			}
			identities.add(key);
		}
		return { tables: rows, files };
	} catch (cause) {
		for (const entry of files) {
			entry.content.fill(0);
		}
		if (cause instanceof SnapshotFailure) {
			throw cause;
		}
		throw new SnapshotFailure('invalid_archive', { cause });
	}
}
