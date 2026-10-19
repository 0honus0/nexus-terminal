import { TARGET_HOST_KEY_HOST_MAX_BYTES, TARGET_HOST_KEY_FINGERPRINT_PATTERN } from './values.js';
import { TARGET_MANAGEMENT_MAX_ITEMS } from '../values.js';
import type { TargetHostKeyView } from './model.js';
import type { TargetHostKeyConfirmRequest, TargetHostKeyRequest, TargetHostKeyRemoveResponse } from './http.js';
import { targetObject, targetText, targetNumber, targetArray, InvalidTargetPayload } from '../http.js';

function readHost(input: unknown): string {
	const host = targetText(input, TARGET_HOST_KEY_HOST_MAX_BYTES, false).toLowerCase();
	if (/[\s\u0000-\u001f\u007f]/u.test(host)) {
		throw new InvalidTargetPayload();
	}
	return targetText(host, TARGET_HOST_KEY_HOST_MAX_BYTES, false);
}

function readFingerprint(input: unknown): string {
	const fingerprint = targetText(input, 50, false);
	if (!TARGET_HOST_KEY_FINGERPRINT_PATTERN.test(fingerprint)) {
		throw new InvalidTargetPayload();
	}
	return fingerprint;
}

export function readHostKeyRequest(input: unknown): TargetHostKeyRequest {
	const row = targetObject(input, ['host', 'port']);
	return { host: readHost(row.host), port: targetNumber(row.port, 65535) };
}

export function readHostKeyConfirmRequest(input: unknown): TargetHostKeyConfirmRequest {
	const row = targetObject(input, ['host', 'port', 'fingerprint']);
	return {
		host: readHost(row.host),
		port: targetNumber(row.port, 65535),
		fingerprint: readFingerprint(row.fingerprint),
	};
}

export function readHostKeyView(input: unknown): TargetHostKeyView {
	const row = targetObject(input, ['host', 'port', 'fingerprint', 'confirmedAt']);
	const host = readHost(row.host);
	if (host !== row.host) {
		throw new InvalidTargetPayload();
	}
	return {
		host,
		port: targetNumber(row.port, 65535),
		fingerprint: readFingerprint(row.fingerprint),
		confirmedAt: targetNumber(row.confirmedAt, Number.MAX_SAFE_INTEGER, 0),
	};
}

export function readHostKeyList(input: unknown): TargetHostKeyView[] {
	const items = targetArray(input, readHostKeyView, TARGET_MANAGEMENT_MAX_ITEMS);
	const identities = new Set(items.map((item) => JSON.stringify([item.host, item.port])));
	if (identities.size !== items.length) {
		throw new InvalidTargetPayload();
	}
	return items;
}

export function readHostKeyRemoveResponse(input: unknown): TargetHostKeyRemoveResponse {
	const row = targetObject(input, ['removed']);
	if (row.removed !== true) {
		throw new InvalidTargetPayload();
	}
	return { removed: true };
}
