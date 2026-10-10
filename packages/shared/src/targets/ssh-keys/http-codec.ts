import type { TargetSshKeyView, TargetSshKeyMutation } from './model.js';
import type { TargetSshKeyInput, TargetSshKeyChanges, TargetSshKeyUpdateRequest } from './http.js';
import {
	targetObject,
	targetText,
	targetNumber,
	readTargetMutation,
	InvalidTargetPayload,
	targetNullable,
} from '../http.js';

const KEY_FIELDS = ['name', 'privateKey', 'passphrase'] as const;

export function readSshKeyInput(input: unknown): TargetSshKeyInput {
	const row = targetObject(input, KEY_FIELDS, ['name', 'privateKey']);
	return {
		name: targetText(row.name, 128, false),
		privateKey: targetText(row.privateKey, 10000, false),
		...(row.passphrase === undefined ? {} : { passphrase: targetNullable(row.passphrase, 8192) }),
	};
}

export function readSshKeyView(input: unknown): TargetSshKeyView {
	const row = targetObject(input, ['id', 'name', 'version', 'createdAt', 'updatedAt']);
	return {
		id: targetNumber(row.id),
		name: targetText(row.name, 128, false),
		version: targetNumber(row.version),
		createdAt: targetNumber(row.createdAt, Number.MAX_SAFE_INTEGER, 0),
		updatedAt: targetNumber(row.updatedAt, Number.MAX_SAFE_INTEGER, 0),
	};
}

export function readSshKeyChanges(input: unknown): TargetSshKeyChanges {
	const row = targetObject(input, KEY_FIELDS, []);
	if (!Object.keys(row).length) throw new InvalidTargetPayload();
	const changes: TargetSshKeyChanges = {};
	if (Object.hasOwn(row, 'name')) changes.name = targetText(row.name, 128, false);
	if (Object.hasOwn(row, 'privateKey')) changes.privateKey = targetText(row.privateKey, 10000, false);
	if (Object.hasOwn(row, 'passphrase')) changes.passphrase = targetNullable(row.passphrase, 8192);
	return changes;
}

export function readSshKeyUpdateRequest(input: unknown): TargetSshKeyUpdateRequest {
	const row = targetObject(input, ['version', 'changes']);
	return { version: targetNumber(row.version), changes: readSshKeyChanges(row.changes) };
}

export function readSshKeyMutation(input: unknown): TargetSshKeyMutation {
	return readTargetMutation(input, readSshKeyView);
}
