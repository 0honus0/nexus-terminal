import {
	booleanStorageCodec,
	readStoredValue,
	writeStoredValue,
	type BrowserStorageDefinition,
} from '@/foundation/browser';
import { authenticatedSessionLifecycle } from '@/shared/session/public';
import type { RemoteTool } from '@nexus-terminal/shared/remote/tools/values';

function preference(targetId: number, tool: RemoteTool): BrowserStorageDefinition<boolean> | null {
	const userId = authenticatedSessionLifecycle.userId;
	return userId === null
		? null
		: {
				namespace: `remote-tools.declined.${targetId}.${tool}`,
				version: 1,
				scope: { kind: 'user', id: userId },
				codec: booleanStorageCodec,
			};
}

export function hasDeclinedTool(targetId: number, tool: RemoteTool): boolean {
	const storage = preference(targetId, tool);
	return storage !== null && readStoredValue(storage) === true;
}

export function rememberDeclinedTools(targetId: number, tools: readonly RemoteTool[]): void {
	for (const tool of tools) {
		const storage = preference(targetId, tool);
		if (storage !== null) {
			writeStoredValue(storage, true);
		}
	}
}
