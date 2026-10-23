import { isWellFormedFileText } from '../files/text-codec.js';
import type {
	ServerTransferInput,
	ServerTransferSource,
	ServerTransferSnapshot,
	ServerTransferItem,
} from './server-model.js';
import type { ServerTransferPage, ServerTransferCancellation, ServerTransferHttpError } from './server-http.js';
import {
	SERVER_TRANSFER_METHODS,
	SERVER_TRANSFER_TASK_STATES,
	SERVER_TRANSFER_ITEM_STATES,
	SERVER_TRANSFER_ERROR_CODES,
	SERVER_TRANSFER_MAX_TARGETS,
	SERVER_TRANSFER_MAX_SOURCES,
	SERVER_TRANSFER_MAX_ITEMS,
	SERVER_TRANSFER_MAX_NAME_BYTES,
	SERVER_TRANSFER_MAX_PATH_BYTES,
	SERVER_TRANSFER_REQUEST_MAX_BYTES,
	SERVER_TRANSFER_TASK_MAX_BYTES,
	SERVER_TRANSFER_PAGE_SIZE,
	SERVER_TRANSFER_PAGE_MAX_BYTES,
} from './server-values.js';

export class InvalidServerTransferPayload extends Error {
	constructor() {
		super('Invalid server transfer payload');
	}
}

function reject(): never {
	throw new InvalidServerTransferPayload();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!isRecord(value) || Object.keys(value).some((key) => !fields.includes(key))) {
		return reject();
	}
	return value;
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		return reject();
	}
	return value;
}

function choice<T extends string>(value: unknown, values: readonly T[]): T {
	for (const item of values) {
		if (value === item) {
			return item;
		}
	}
	return reject();
}

function budget(value: unknown, max: number): void {
	const json = JSON.stringify(value);
	if (json === undefined || new TextEncoder().encode(json).length > max) {
		reject();
	}
}

function text(value: unknown, max: number): string {
	if (
		typeof value !== 'string' ||
		!value.length ||
		!isWellFormedFileText(value) ||
		/[\u0000-\u001f\u007f]/u.test(value) ||
		new TextEncoder().encode(value).length > max
	) {
		return reject();
	}
	return value;
}

function path(value: unknown): string {
	const result = text(value, SERVER_TRANSFER_MAX_PATH_BYTES);
	if (
		!result.startsWith('/') ||
		result === '/' ||
		result.endsWith('/') ||
		result
			.slice(1)
			.split('/')
			.some((part) => !part || part === '.' || part === '..')
	) {
		return reject();
	}
	return result;
}

export function readServerTransferId(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
	) {
		return reject();
	}
	return value;
}

function source(value: unknown): ServerTransferSource {
	const item = record(value, ['name', 'path', 'type']);
	const name = text(item.name, SERVER_TRANSFER_MAX_NAME_BYTES);
	const sourcePath = path(item.path);
	if (name !== sourcePath.slice(sourcePath.lastIndexOf('/') + 1)) {
		return reject();
	}
	return { name, path: sourcePath, type: choice(item.type, ['file', 'directory']) };
}

export function readServerTransferInput(value: unknown): ServerTransferInput {
	budget(value, SERVER_TRANSFER_REQUEST_MAX_BYTES);
	const input = record(value, [
		'sourceConnectionId',
		'connectionIds',
		'sourceItems',
		'remoteTargetPath',
		'transferMethod',
	]);
	if (
		!Array.isArray(input.connectionIds) ||
		!input.connectionIds.length ||
		input.connectionIds.length > SERVER_TRANSFER_MAX_TARGETS ||
		!Array.isArray(input.sourceItems) ||
		!input.sourceItems.length ||
		input.sourceItems.length > SERVER_TRANSFER_MAX_SOURCES ||
		input.connectionIds.length * input.sourceItems.length > SERVER_TRANSFER_MAX_ITEMS
	) {
		return reject();
	}
	const sourceConnectionId = integer(input.sourceConnectionId, 1);
	const connectionIds = input.connectionIds.map((id) => integer(id, 1));
	const sourceItems = input.sourceItems.map(source);
	if (
		new Set(connectionIds).size !== connectionIds.length ||
		connectionIds.includes(sourceConnectionId) ||
		new Set(sourceItems.map((item) => item.path)).size !== sourceItems.length ||
		new Set(sourceItems.map((item) => item.name)).size !== sourceItems.length
	) {
		return reject();
	}
	for (const item of sourceItems) {
		if (sourceItems.some((other) => other !== item && item.path.startsWith(other.path + '/'))) {
			reject();
		}
	}
	return {
		sourceConnectionId,
		connectionIds,
		sourceItems,
		remoteTargetPath: input.remoteTargetPath === '/' ? '/' : path(input.remoteTargetPath),
		transferMethod: choice(input.transferMethod, SERVER_TRANSFER_METHODS),
	};
}

function percent(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
		return reject();
	}
	return value;
}

function item(value: unknown): ServerTransferItem {
	const row = record(value, [
		'subTaskId',
		'connectionId',
		'sourceItemIndex',
		'status',
		'progress',
		'error',
		'transferMethodUsed',
	]);
	const status = choice(row.status, SERVER_TRANSFER_ITEM_STATES);
	const error = row.error === null ? null : choice(row.error, SERVER_TRANSFER_ERROR_CODES);
	const method = row.transferMethodUsed === null ? null : choice(row.transferMethodUsed, ['rsync', 'scp']);
	const progress = percent(row.progress);
	if (
		(status === 'failed' || status === 'unknown') !== (error !== null) ||
		(status === 'completed' && (progress !== 100 || method === null)) ||
		(status === 'queued' && (progress !== 0 || method !== null))
	) {
		return reject();
	}
	return {
		subTaskId: readServerTransferId(row.subTaskId),
		connectionId: integer(row.connectionId, 1),
		sourceItemIndex: integer(row.sourceItemIndex, 0, SERVER_TRANSFER_MAX_SOURCES - 1),
		status,
		progress,
		error,
		transferMethodUsed: method,
	};
}

export function readServerTransferSnapshot(value: unknown): ServerTransferSnapshot {
	budget(value, SERVER_TRANSFER_TASK_MAX_BYTES);
	const row = record(value, ['taskId', 'status', 'createdAt', 'updatedAt', 'overallProgress', 'payload', 'subTasks']);
	const payload = readServerTransferInput(row.payload);
	if (
		!Array.isArray(row.subTasks) ||
		row.subTasks.length !== payload.sourceItems.length * payload.connectionIds.length
	) {
		return reject();
	}
	const subTasks = row.subTasks.map(item);
	const ids = new Set<string>();
	const pairs = new Set<string>();
	for (const sub of subTasks) {
		const pair = sub.connectionId + ':' + sub.sourceItemIndex;
		if (
			ids.has(sub.subTaskId) ||
			pairs.has(pair) ||
			!payload.connectionIds.includes(sub.connectionId) ||
			sub.sourceItemIndex >= payload.sourceItems.length ||
			(payload.transferMethod !== 'auto' &&
				sub.transferMethodUsed !== null &&
				sub.transferMethodUsed !== payload.transferMethod)
		) {
			reject();
		}
		ids.add(sub.subTaskId);
		pairs.add(pair);
	}
	const createdAt = integer(row.createdAt, 1);
	const updatedAt = integer(row.updatedAt, createdAt);
	const status = choice(row.status, SERVER_TRANSFER_TASK_STATES);
	const complete = subTasks.filter((sub) => sub.status === 'completed').length;
	const failed = subTasks.filter((sub) => sub.status === 'failed').length;
	const unknown = subTasks.some((sub) => sub.status === 'unknown');
	const settled = subTasks.every((sub) => ['completed', 'failed', 'cancelled', 'unknown'].includes(sub.status));
	if (
		(status === 'completed' && complete !== subTasks.length) ||
		(status === 'unknown' && (!settled || !unknown)) ||
		(status === 'partially-completed' && (!settled || unknown || complete === 0 || complete === subTasks.length)) ||
		(status === 'failed' && (!settled || unknown || complete > 0 || failed === 0)) ||
		(status === 'cancelled' && !subTasks.every((sub) => sub.status === 'cancelled')) ||
		(status === 'queued' && !subTasks.every((sub) => sub.status === 'queued'))
	) {
		reject();
	}
	const overallProgress = percent(row.overallProgress);
	if (overallProgress !== Math.floor(subTasks.reduce((sum, sub) => sum + sub.progress, 0) / subTasks.length)) {
		reject();
	}
	return {
		taskId: readServerTransferId(row.taskId),
		status,
		createdAt,
		updatedAt,
		overallProgress,
		payload,
		subTasks,
	};
}

export function readServerTransferPage(value: unknown): ServerTransferPage {
	budget(value, SERVER_TRANSFER_PAGE_MAX_BYTES);
	const row = record(value, ['items', 'nextCursor']);
	if (!Array.isArray(row.items) || row.items.length > SERVER_TRANSFER_PAGE_SIZE) {
		return reject();
	}
	const items = row.items.map(readServerTransferSnapshot);
	const nextCursor = row.nextCursor === null ? null : readServerTransferId(row.nextCursor);
	if (
		items.some((item, index) => index > 0 && items[index - 1].taskId >= item.taskId) ||
		(nextCursor !== null && (items.length !== SERVER_TRANSFER_PAGE_SIZE || items.at(-1)?.taskId !== nextCursor))
	) {
		return reject();
	}
	return { items, nextCursor };
}

export function readServerTransferCancellation(value: unknown): ServerTransferCancellation {
	const row = record(value, ['taskId', 'accepted']);
	if (row.accepted !== true) {
		return reject();
	}
	return { taskId: readServerTransferId(row.taskId), accepted: true };
}

export function readServerTransferError(value: unknown): ServerTransferHttpError {
	const row = record(value, ['code']);
	return { code: choice(row.code, SERVER_TRANSFER_ERROR_CODES) };
}
