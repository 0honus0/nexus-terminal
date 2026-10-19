import type { NativeEntryCursor, NativeRun, NativeChild } from './native-run-types';

export function isNativeRunActive(run: NativeRun | NativeChild): boolean {
	return run.status === 'pending' || run.status === 'running' || run.status === 'unknown';
}

export function compareNativeEntryCursor(left: NativeEntryCursor, right: NativeEntryCursor): number {
	return (
		left.runSequence - right.runSequence ||
		left.stepIndex - right.stepIndex ||
		left.eventSequence - right.eventSequence ||
		left.textOffset - right.textOffset
	);
}

export function nativeModelKey(model: { providerId: string; modelId: string; configurationVersion: number }): string {
	return JSON.stringify([model.providerId, model.modelId, model.configurationVersion]);
}
