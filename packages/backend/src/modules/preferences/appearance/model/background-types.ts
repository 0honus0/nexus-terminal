import type { BackgroundKind, BackgroundMediaType } from '@nexus-terminal/shared/preferences/appearance/values';
import type { AppearanceRecord } from './appearance-types.js';

export interface BackgroundUpload {
	kind: BackgroundKind;
	expectedVersion: number;
	bytes: Uint8Array;
	mediaType: BackgroundMediaType;
}

export interface BackgroundRecord {
	id: string;
	userId: number;
	kind: BackgroundKind;
	mediaType: BackgroundMediaType;
	sizeBytes: number;
	sha256: string;
}

export interface BackgroundWriteFacts {
	appearance: AppearanceRecord | null;
	totalCount: number;
}

export interface BackgroundMutation {
	appearance: AppearanceRecord;
	cleanupPending: boolean;
}

export interface BackgroundContent {
	mediaType: BackgroundMediaType;
	sizeBytes: number;
	transfer(deliver: (chunk: Uint8Array) => Promise<void>): Promise<void>;
}

export interface BackgroundInspection {
	mediaType: BackgroundMediaType | null;
	sizeBytes: number;
	sha256: string;
}
