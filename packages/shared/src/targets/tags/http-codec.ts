import type { TargetTagView, TargetTagMutation } from './model.js';
import type { TargetTagCreateRequest, TargetTagRenameRequest } from './http.js';
import { targetObject, targetText, targetNumber, readTargetMutation } from '../http.js';

export function readTagView(input: unknown): TargetTagView {
	const row = targetObject(input, ['id', 'name', 'version', 'createdAt', 'updatedAt']);
	return {
		id: targetNumber(row.id),
		name: targetText(row.name, 128, false),
		version: targetNumber(row.version),
		createdAt: targetNumber(row.createdAt, Number.MAX_SAFE_INTEGER, 0),
		updatedAt: targetNumber(row.updatedAt, Number.MAX_SAFE_INTEGER, 0),
	};
}

export function readTagCreateRequest(input: unknown): TargetTagCreateRequest {
	const row = targetObject(input, ['name']);
	return { name: targetText(row.name, 128, false) };
}

export function readTagRenameRequest(input: unknown): TargetTagRenameRequest {
	const row = targetObject(input, ['version', 'name']);
	return { version: targetNumber(row.version), name: targetText(row.name, 128, false) };
}

export function readTagMutation(input: unknown): TargetTagMutation {
	return readTargetMutation(input, readTagView);
}
