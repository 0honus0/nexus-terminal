import type { TargetTagView, TargetTagMutation } from './model.js';
import type { TargetTagCreateRequest, TargetTagRenameRequest } from './http.js';
import { targetObject, targetText, targetNumber, readTargetMutation } from '../http.js';
import { targetArray, InvalidTargetPayload } from '../http.js';
import { TARGET_TAG_CONNECTION_MAX_ITEMS, TARGET_TAG_NAME_MAX_BYTES } from './values.js';
import type { TargetTagConnectionsRequest, TargetTagConnectionsResponse } from './http.js';
import { TARGET_MANAGEMENT_MAX_ITEMS } from '../values.js';

export function readTagView(input: unknown): TargetTagView {
	const row = targetObject(input, ['id', 'name', 'version', 'createdAt', 'updatedAt']);
	if (typeof row.createdAt === 'number' && typeof row.updatedAt === 'number' && row.updatedAt < row.createdAt) {
		throw new InvalidTargetPayload();
	}
	return {
		id: targetNumber(row.id),
		name: targetText(row.name, TARGET_TAG_NAME_MAX_BYTES, false),
		version: targetNumber(row.version),
		createdAt: targetNumber(row.createdAt, Number.MAX_SAFE_INTEGER, 0),
		updatedAt: targetNumber(row.updatedAt, Number.MAX_SAFE_INTEGER, 0),
	};
}

export function readTagList(input: unknown): TargetTagView[] {
	const items = targetArray(input, readTagView, TARGET_MANAGEMENT_MAX_ITEMS);
	if (new Set(items.map((item) => item.id)).size !== items.length) {
		throw new InvalidTargetPayload();
	}
	return items;
}

export function readTagCreateRequest(input: unknown): TargetTagCreateRequest {
	const row = targetObject(input, ['name']);
	return { name: targetText(row.name, TARGET_TAG_NAME_MAX_BYTES, false) };
}

export function readTagRenameRequest(input: unknown): TargetTagRenameRequest {
	const row = targetObject(input, ['version', 'name']);
	return { version: targetNumber(row.version), name: targetText(row.name, TARGET_TAG_NAME_MAX_BYTES, false) };
}

export function readTagMutation(input: unknown): TargetTagMutation {
	return readTargetMutation(input, readTagView);
}

/** Duplicates are valid; the application owns set normalization. */
export function readTagConnectionIds(input: unknown): number[] {
	return targetArray(input, (id) => targetNumber(id), TARGET_TAG_CONNECTION_MAX_ITEMS);
}

export function readTagConnectionsRequest(input: unknown): TargetTagConnectionsRequest {
	const row = targetObject(input, ['connectionIds']);
	return { connectionIds: readTagConnectionIds(row.connectionIds) };
}

export function readTagConnectionsResponse(input: unknown): TargetTagConnectionsResponse {
	const row = targetObject(input, ['updated']);
	if (row.updated !== true) {
		throw new InvalidTargetPayload();
	}
	return { updated: true };
}
