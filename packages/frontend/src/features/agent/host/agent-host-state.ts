import { inject, provide, type InjectionKey } from 'vue';
import { createAgentWindowManager, type AgentWindowManager } from './window-manager';

export interface AgentHostState {
	windowManager: AgentWindowManager;
}

const agentHostStateKey: InjectionKey<AgentHostState> = Symbol('agent-host-state');

export const provideAgentHostState = (): AgentHostState => {
	const state = { windowManager: createAgentWindowManager() };
	provide(agentHostStateKey, state);
	return state;
};

export const useAgentHostState = (): AgentHostState => {
	const state = inject(agentHostStateKey);
	if (!state) throw new Error('Agent host state provider is unavailable.');
	return state;
};
