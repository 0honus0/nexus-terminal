import { inject, provide, shallowReactive, type InjectionKey } from 'vue';
import { createAgentWindowManager, type AgentWindowManager } from './window-manager';
import type { AgentTaskActivity, AgentTaskActivityRegistration } from '../model/task-activity-types';

export interface AgentHostState {
	windowManager: AgentWindowManager;
	taskActivities: ReadonlyMap<symbol, AgentTaskActivity | null>;
	registerTaskActivity(): AgentTaskActivityRegistration;
}

const agentHostStateKey: InjectionKey<AgentHostState> = Symbol('agent-host-state');

export const provideAgentHostState = (): AgentHostState => {
	const activities = shallowReactive(new Map<symbol, AgentTaskActivity | null>());
	const state: AgentHostState = {
		windowManager: createAgentWindowManager(),
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
