import type { BackgroundKind, BackgroundMediaType } from '@nexus-terminal/shared/preferences/appearance/values';
import type { StoredAppearance, AppearanceAuthorization } from './appearance-storage.js';

export interface StoredBackground {
	id: string;
	userId: number;
	kind: BackgroundKind;
	mediaType: BackgroundMediaType;
	sizeBytes: number;
	sha256: string;
}

export interface StoredBackgroundFacts {
	appearance: StoredAppearance | null;
	totalCount: number;
}

export interface BackgroundStorage {
	stage(
		record: StoredBackground,
		authorization: AppearanceAuthorization,
		admit: (facts: StoredBackgroundFacts) => void,
	): Promise<void>;
	activate(
		id: string,
		userId: number,
		expectedVersion: number,
		authorization: AppearanceAuthorization,
		admit: (facts: StoredBackgroundFacts) => void,
	): Promise<StoredAppearance>;
	clear(
		kind: BackgroundKind,
		userId: number,
		authorization: AppearanceAuthorization,
		admit: (facts: StoredBackgroundFacts) => void,
	): Promise<StoredAppearance>;
	get(userId: number, id: string): Promise<StoredBackground | null>;
	cleanupCandidates(limit: number): Promise<string[]>;
	finishCleanup(id: string): Promise<void>;
}
