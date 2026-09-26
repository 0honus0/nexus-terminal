import { inject, provide, type InjectionKey } from 'vue';
import { createAgentSurfaceSession, type AgentSurfaceSession } from './surface-session';
import { createAgentWindowManager, type AgentWindowManager } from './window-manager';

export interface AgentHostState {
  surfaceSession: AgentSurfaceSession;
  windowManager: AgentWindowManager;
}

const agentHostStateKey: InjectionKey<AgentHostState> = Symbol('agent-host-state');

export const provideAgentHostState = (): AgentHostState => {
  const state = { surfaceSession: createAgentSurfaceSession(), windowManager: createAgentWindowManager() };
  provide(agentHostStateKey, state);
  return state;
};

export const useAgentHostState = (): AgentHostState => {
  const state = inject(agentHostStateKey);
  if (!state) throw new Error('Agent host state provider is unavailable.');
  return state;
};
