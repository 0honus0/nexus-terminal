import {
	TARGET_SSH_KEY_NAME_MAX_BYTES,
	TARGET_SSH_PRIVATE_KEY_MAX_BYTES,
	TARGET_SSH_PASSPHRASE_MAX_BYTES,
} from './values.js';
import type { TargetSshKeyView, TargetSshKeyMutation } from './model.js';
import type { TargetSshKeyInput, TargetSshKeyChanges, TargetSshKeyUpdateRequest } from './http.js';
import { TARGET_MANAGEMENT_MAX_ITEMS } from '../values.js';
import {
	targetObject,
	targetArray,
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
		name: targetText(row.name, TARGET_SSH_KEY_NAME_MAX_BYTES, false),
		privateKey: targetText(row.privateKey, TARGET_SSH_PRIVATE_KEY_MAX_BYTES, false),
		...(row.passphrase === undefined
			? {}
			: { passphrase: targetNullable(row.passphrase, TARGET_SSH_PASSPHRASE_MAX_BYTES) }),
	};
}

export function readSshKeyView(input: unknown): TargetSshKeyView {
	const row = targetObject(input, ['id', 'name', 'version', 'createdAt', 'updatedAt']);
	const createdAt = targetNumber(row.createdAt, Number.MAX_SAFE_INTEGER, 0);
	const updatedAt = targetNumber(row.updatedAt, Number.MAX_SAFE_INTEGER, createdAt);
	return {
		id: targetNumber(row.id),
		name: targetText(row.name, TARGET_SSH_KEY_NAME_MAX_BYTES, false),
		version: targetNumber(row.version),
		createdAt,
		updatedAt,
	};
}

export function readSshKeyList(input: unknown): TargetSshKeyView[] {
	const items = targetArray(input, readSshKeyView, TARGET_MANAGEMENT_MAX_ITEMS);
	if (new Set(items.map((item) => item.id)).size !== items.length) {
		throw new InvalidTargetPayload();
	}
	return items;
}

export function readSshKeyChanges(input: unknown): TargetSshKeyChanges {
	const row = targetObject(input, KEY_FIELDS, []);
	if (!Object.keys(row).length) {
		throw new InvalidTargetPayload();
	}
	const changes: TargetSshKeyChanges = {};
	if (Object.hasOwn(row, 'name')) {
		changes.name = targetText(row.name, TARGET_SSH_KEY_NAME_MAX_BYTES, false);
	}
	if (Object.hasOwn(row, 'privateKey')) {
		changes.privateKey = targetText(row.privateKey, TARGET_SSH_PRIVATE_KEY_MAX_BYTES, false);
	}
	if (Object.hasOwn(row, 'passphrase')) {
		changes.passphrase = targetNullable(row.passphrase, TARGET_SSH_PASSPHRASE_MAX_BYTES);
	}
	return changes;
}

export function readSshKeyUpdateRequest(input: unknown): TargetSshKeyUpdateRequest {
	const row = targetObject(input, ['version', 'changes']);
	return { version: targetNumber(row.version), changes: readSshKeyChanges(row.changes) };
}

export function readSshKeyMutation(input: unknown): TargetSshKeyMutation {
	return readTargetMutation(input, readSshKeyView);
}
