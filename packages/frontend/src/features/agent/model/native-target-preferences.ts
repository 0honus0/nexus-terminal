import { jsonStorageCodec, readStoredValue, writeStoredValue } from '@/foundation/browser';
import type { BrowserStorageDefinition } from '@/foundation/browser';

const targetIdsCodec = jsonStorageCodec<number[]>((value) => {
	if (!Array.isArray(value)) return undefined;
	const ids: number[] = [];
	for (const id of value) {
		if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return undefined;
		ids.push(id);
	}
	return new Set(ids).size === ids.length ? ids : undefined;
});

function preferences(userId: number, appId: string): BrowserStorageDefinition<number[]> {
	return {
		namespace: 'agent.targets.' + encodeURIComponent(appId),
		version: 1,
		scope: { kind: 'user', id: userId },
		codec: targetIdsCodec,
	};
}

export function readNativeTargetPreference(userId: number, appId: string): number[] {
	return readStoredValue(preferences(userId, appId)) ?? [];
}

export function writeNativeTargetPreference(userId: number, appId: string, ids: number[]): void {
	writeStoredValue(preferences(userId, appId), ids);
}
