import { reactive } from 'vue';

export interface AgentAppViewState {
  threadId?: string;
  draft: string;
  scrollAnchor?: string;
  selectedTaskId?: string;
  hubView: 'conversation' | 'files';
}

const perAppViewState = reactive(new Map<string, AgentAppViewState>());
let navigationGeneration = 0;

const ensure = (appId: string): AgentAppViewState => {
  let state = perAppViewState.get(appId);
  if (!state) {
    state = { draft: '', hubView: 'conversation' };
    perAppViewState.set(appId, state);
  }
  return state;
};

export const agentSurfaceSession = {
  state(appId: string): AgentAppViewState {
    return ensure(appId);
  },
  activateApp(appId: string): number {
    ensure(appId);
    navigationGeneration += 1;
    return navigationGeneration;
  },
  currentGeneration(): number {
    return navigationGeneration;
  },
  restoreThread(appId: string): string | undefined {
    return ensure(appId).threadId;
  },
  setThread(appId: string, threadId?: string): void {
    const state = ensure(appId);
    if (threadId) state.threadId = threadId;
    else delete state.threadId;
  },
  setDraft(appId: string, draft: string): void {
    ensure(appId).draft = draft;
  },
  pauseDetail(_appId: string): void {
    navigationGeneration += 1;
  },
  disposeSession(): void {
    navigationGeneration += 1;
    perAppViewState.clear();
  },
};
