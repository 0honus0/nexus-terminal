import type { AgentPluginUiCheckpoint } from '@nexus-terminal/shared/agent/plugins/ui-events';
import { inject, provide, shallowReactive, type InjectionKey } from 'vue';
import { createAgentWindowManager, type AgentWindowManager } from './window-manager';
import type { AgentTaskActivity, AgentTaskActivityRegistration } from '../model/task-activity-types';

export interface AgentHostState {
	windowManager: AgentWindowManager;
	uiCheckpoints: Map<string, AgentPluginUiCheckpoint>;
	clearUiState(): void;
	clearAppUiState(appId: string): void;
	taskActivities: ReadonlyMap<symbol, AgentTaskActivity | null>;
	registerTaskActivity(): AgentTaskActivityRegistration;
}

/** Stable across UI version updates, isolated by authenticated App and signed package publisher. */
export function uiCheckpointKey(appId: string, packageId: string, publisherKeyId: string): string {
	return JSON.stringify([appId, packageId, publisherKeyId]);
}

const agentHostStateKey: InjectionKey<AgentHostState> = Symbol('agent-host-state');

export const provideAgentHostState = (): AgentHostState => {
	const activities = shallowReactive(new Map<symbol, AgentTaskActivity | null>());
	const state: AgentHostState = {
		windowManager: createAgentWindowManager(),
		uiCheckpoints: new Map(),

		clearUiState(): void {
			this.uiCheckpoints.clear();
		},

		clearAppUiState(appId): void {
			const prefix = JSON.stringify([appId]).slice(0, -1) + ',';
			for (const key of this.uiCheckpoints.keys()) {
				if (key.startsWith(prefix)) this.uiCheckpoints.delete(key);
			}
		},

		taskActivities: activities,

		registerTaskActivity(): AgentTaskActivityRegistration {
			const owner = Symbol('native-task-activity');
			let disposed = false;
			activities.set(owner, null);
			return {
				update(activity): void {
					if (!disposed) {
						activities.set(owner, activity);
					}
				},

				dispose(): void {
					disposed = true;
					activities.delete(owner);
				},
			};
		},
	};
	provide(agentHostStateKey, state);
	return state;
};

export const useAgentHostState = (): AgentHostState => {
	const state = inject(agentHostStateKey);
	if (!state) throw new Error('Agent host state provider is unavailable.');
	return state;
};
