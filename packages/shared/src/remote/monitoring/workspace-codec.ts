import { InvalidObservationPayload } from './http-codec.js';
import type { WorkspaceStatusError } from './events.js';
import { OBSERVATION_ERROR_CODES } from './values.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readWorkspaceObservationEmpty(value: unknown): void {
	if (!isRecord(value) || Object.keys(value).length !== 0) {
		throw new InvalidObservationPayload();
	}
}

export function readWorkspaceStatusError(value: unknown): WorkspaceStatusError {
	if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'message')) {
		throw new InvalidObservationPayload();
	}
	const message = OBSERVATION_ERROR_CODES.find((code) => code === value.message);
	if (!message) {
		throw new InvalidObservationPayload();
	}
	return { message };
}
