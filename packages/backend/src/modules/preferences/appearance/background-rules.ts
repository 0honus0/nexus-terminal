import {
	BACKGROUND_MAX_BYTES,
	BACKGROUND_KINDS,
	BACKGROUND_MEDIA_TYPES,
} from '@nexus-terminal/shared/preferences/appearance/values';
import { AppearanceFailure } from '../appearance-failure.js';
import type { BackgroundUpload, BackgroundWriteFacts } from './model/background-types.js';

export const MAX_STORED_BACKGROUNDS = 1024;

export function validateBackgroundUpload(input: BackgroundUpload): void {
	if (
		!BACKGROUND_KINDS.includes(input.kind) ||
		!BACKGROUND_MEDIA_TYPES.includes(input.mediaType) ||
		input.bytes.byteLength < 1
	) {
		throw new AppearanceFailure('invalid_input');
	}
	if (input.bytes.byteLength > BACKGROUND_MAX_BYTES) {
		throw new AppearanceFailure('limit_exceeded');
	}
}

export function admitBackgroundWrite(facts: BackgroundWriteFacts, expectedVersion: number, reserve: boolean): void {
	if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= Number.MAX_SAFE_INTEGER) {
		throw new AppearanceFailure('invalid_input');
	}
	if (facts.appearance === null || facts.appearance.version !== expectedVersion) {
		throw new AppearanceFailure('version_conflict');
	}
	if (reserve && facts.totalCount >= MAX_STORED_BACKGROUNDS) {
		throw new AppearanceFailure('limit_exceeded');
	}
}
