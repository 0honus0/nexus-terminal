import type { TargetHostKeyView } from './model.js';
import type { TargetHostKeyConfirmRequest, TargetHostKeyRequest, TargetHostKeyRemoveResponse } from './http.js';
import { targetObject, targetText, targetNumber, InvalidTargetPayload } from '../http.js';

export function readHostKeyRequest(input: unknown): TargetHostKeyRequest {
	const row = targetObject(input, ['host', 'port']);
	return { host: targetText(row.host, 253, false), port: targetNumber(row.port, 65535) };
}

export function readHostKeyConfirmRequest(input: unknown): TargetHostKeyConfirmRequest {
	const row = targetObject(input, ['host', 'port', 'fingerprint']);
	return {
		host: targetText(row.host, 253, false),
		port: targetNumber(row.port, 65535),
		fingerprint: targetText(row.fingerprint, 51, false),
	};
}

export function readHostKeyView(input: unknown): TargetHostKeyView {
	const row = targetObject(input, ['host', 'port', 'fingerprint', 'confirmedAt']);
	return {
		host: targetText(row.host, 253, false),
		port: targetNumber(row.port, 65535),
		fingerprint: targetText(row.fingerprint, 51, false),
		confirmedAt: targetNumber(row.confirmedAt, Number.MAX_SAFE_INTEGER, 0),
	};
}

export function readHostKeyRemoveResponse(input: unknown): TargetHostKeyRemoveResponse {
	const row = targetObject(input, ['removed']);
	if (row.removed !== true) {
		throw new InvalidTargetPayload();
	}
	return { removed: true };
}
