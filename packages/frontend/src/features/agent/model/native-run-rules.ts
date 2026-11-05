import { AgentManagementFailure } from './management-failure';
import type {
	NativeEntryCursor,
	NativeApproval,
	NativeRun,
	NativeChild,
	NativeEntry,
	NativeConversationEntry,
	NativeTool,
	NativeConversationSnapshot,
} from './native-run-types';

export const NATIVE_CONVERSATION_MAX_ENTRIES = 128;

export const NATIVE_CONVERSATION_MAX_CHARACTERS = 256 * 1024;

/** Preserve the separately paged history anchor while accepting forward stream data. */
export function appendNativeConversationWindow(
	current: NativeConversationSnapshot,
	page: { items: NativeEntry[]; nextCursor: NativeEntryCursor },
): NativeConversationSnapshot {
	let previous = current.cursor;
	for (const item of page.items) {
		if (compareNativeEntryCursor(previous, item.position) >= 0) {
			throw new AgentManagementFailure('protocol_failure', 'unknown');
		}
		previous = item.position;
	}
	const combined = appendNativeConversationEntries(current.entries, page.items);
	return {
		entries: combined,
		cursor: page.nextCursor,
		startCursor: current.startCursor,
		olderHidden: current.olderHidden,
	};
}

export function isNativeRunActive(run: NativeRun | NativeChild): boolean {
	return run.status === 'pending' || run.status === 'running';
}

/** An unconfirmed effect has stopped execution but still requires explicit closure. */
export function canCancelNativeRun(run: NativeRun | NativeChild): boolean {
	return isNativeRunActive(run) || run.status === 'unknown';
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

/** Merge presentation only; never derive the transport continuation from the display anchor. */
export function appendNativeConversationEntries(
	current: readonly NativeConversationEntry[],
	incoming: readonly NativeEntry[],
): NativeConversationEntry[] {
	const combined = current.slice();
	for (const item of incoming) {
		const previous = combined.at(-1);
		const continuesMessage =
			previous &&
			previous.runId === item.runId &&
			previous.role === item.role &&
			previous.position.runSequence === item.position.runSequence &&
			previous.position.stepIndex === item.position.stepIndex &&
			(item.role === 'assistant' || previous.position.eventSequence === item.position.eventSequence);
		if (continuesMessage) {
			combined[combined.length - 1] = {
				runId: previous.runId,
				role: previous.role,
				position: previous.position,
				text: previous.text + item.text,
			};
		} else {
			combined.push({
				runId: item.runId,
				role: item.role,
				position: {
					runSequence: item.position.runSequence,
					stepIndex: item.position.stepIndex,
					eventSequence: item.position.eventSequence,
					textOffset: item.position.textOffset,
				},
				text: item.text,
			});
		}
	}
	return combined;
}

export function mergeNativeTools(current: readonly NativeTool[], incoming: readonly NativeTool[]): NativeTool[] {
	const items = new Map(current.map((item) => [item.id, item]));
	for (const item of incoming) {
		const old = items.get(item.id);
		if (!old || old.revision < item.revision) items.set(item.id, item);
	}
	return [...items.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function mergeNativeApprovals(
	current: readonly NativeApproval[],
	incoming: readonly NativeApproval[],
): NativeApproval[] {
	const items = new Map(current.map((item) => [item.id, item]));
	for (const item of incoming) {
		const old = items.get(item.id);
		if (!old || old.version < item.version) items.set(item.id, item);
	}
	return [...items.values()].sort((a, b) => a.requestedAt - b.requestedAt || a.id.localeCompare(b.id));
}
