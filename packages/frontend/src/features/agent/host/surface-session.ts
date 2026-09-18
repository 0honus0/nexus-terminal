import { reactive } from 'vue';
import type { AgentApprovalMode, AgentExecutionMode, AgentReasoningEffort } from '../api/agent-api';

export interface AgentAppViewState {
  threadId?: string;
  draft: string;
  scrollAnchor?: string;
  selectedTaskId?: string;
  modelKey?: string;
  reasoningEffort?: AgentReasoningEffort;
  approvalMode?: AgentApprovalMode;
  executionMode?: AgentExecutionMode;
  connectionIds?: number[];
  environmentRecipeId?: string;
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
  restoreModelKey(appId: string): string | undefined {
    return ensure(appId).modelKey;
  },
  setModelKey(appId: string, modelKey?: string): void {
    const state = ensure(appId);
    if (modelKey) state.modelKey = modelKey;
    else delete state.modelKey;
  },
  restoreReasoningEffort(appId: string): AgentReasoningEffort | undefined {
    return ensure(appId).reasoningEffort;
  },
  setReasoningEffort(appId: string, effort?: AgentReasoningEffort): void {
    const state = ensure(appId);
    if (effort) state.reasoningEffort = effort;
    else delete state.reasoningEffort;
  },
  restoreApprovalMode(appId: string): AgentApprovalMode | undefined {
    return ensure(appId).approvalMode;
  },
  setApprovalMode(appId: string, approvalMode?: AgentApprovalMode): void {
    const state = ensure(appId);
    if (approvalMode) state.approvalMode = approvalMode;
    else delete state.approvalMode;
  },
  restoreExecutionMode(appId: string): AgentExecutionMode | undefined {
    return ensure(appId).executionMode;
  },
  setExecutionMode(appId: string, executionMode?: AgentExecutionMode): void {
    const state = ensure(appId);
    if (executionMode) state.executionMode = executionMode;
    else delete state.executionMode;
  },
  restoreConnectionIds(appId: string): number[] | undefined {
    const value = ensure(appId).connectionIds;
    return value ? [...value] : undefined;
  },
  setConnectionIds(appId: string, connectionIds?: readonly number[]): void {
    const state = ensure(appId);
    if (connectionIds) state.connectionIds = [...connectionIds];
    else delete state.connectionIds;
  },
  restoreEnvironmentRecipeId(appId: string): string | undefined {
    return ensure(appId).environmentRecipeId;
  },
  setEnvironmentRecipeId(appId: string, recipeId?: string): void {
    const state = ensure(appId);
    if (recipeId) state.environmentRecipeId = recipeId;
    else delete state.environmentRecipeId;
  },
  pauseDetail(_appId: string): void {
    navigationGeneration += 1;
  },
  disposeSession(): void {
    navigationGeneration += 1;
    perAppViewState.clear();
  },
};
