import { ref } from 'vue';
import { agentApi, type PluginWorkspaceGrant } from '../api/agent-api';

export interface WorkspaceGrantScope {
  appId: string;
  runId: string;
}

export interface WorkspaceGrantSelection {
  key: string;
  workspaceId: string;
  workspaceGeneration: number;
  targetPluginId: string;
}

export const createWorkspaceGrantState = (
  scope: () => WorkspaceGrantScope,
  selection: () => WorkspaceGrantSelection | null,
) => {
  const grants = ref<PluginWorkspaceGrant[]>([]);
  const revision = ref<number | null>(null);
  const loading = ref(false);
  let loadGeneration = 0;
  let loadController: AbortController | null = null;

  const scopeKey = (): string => {
    const current = scope();
    return `${current.appId}::${current.runId}`;
  };

  const invalidate = (): void => {
    loadGeneration += 1;
    loadController?.abort();
    loadController = null;
    loading.value = false;
    grants.value = [];
    revision.value = null;
  };

  const isCurrent = (
    generation: number,
    requestScopeKey: string,
    targetKey: string,
    workspaceGeneration: number,
  ): boolean => {
    const current = selection();
    return (
      generation === loadGeneration &&
      requestScopeKey === scopeKey() &&
      current?.key === targetKey &&
      current.workspaceGeneration === workspaceGeneration
    );
  };

  const load = async (): Promise<void> => {
    invalidate();
    const selected = selection();
    if (!selected) return;

    const generation = loadGeneration;
    const requestScope = scope();
    const requestScopeKey = scopeKey();
    const targetKey = selected.key;
    const workspaceGeneration = selected.workspaceGeneration;
    const controller = new AbortController();
    loadController = controller;
    loading.value = true;
    try {
      const result = await agentApi.workspaceGrants(
        requestScope.appId,
        selected.workspaceId,
        selected.targetPluginId,
        controller.signal,
      );
      if (!isCurrent(generation, requestScopeKey, targetKey, workspaceGeneration)) return;
      grants.value = result.grants;
      revision.value = result.revision;
    } catch (cause) {
      if (controller.signal.aborted || !isCurrent(generation, requestScopeKey, targetKey, workspaceGeneration)) return;
      throw cause;
    } finally {
      if (generation === loadGeneration) {
        if (loadController === controller) loadController = null;
        loading.value = false;
      }
    }
  };

  const replace = async (next: PluginWorkspaceGrant[]): Promise<void> => {
    const selected = selection();
    const expectedRevision = revision.value;
    if (!selected || expectedRevision === null) return;
    const requestScope = scope();
    const requestScopeKey = scopeKey();
    const targetKey = selected.key;
    const workspaceGeneration = selected.workspaceGeneration;
    const result = await agentApi.replaceWorkspaceGrants(
      requestScope.appId,
      selected.workspaceId,
      selected.targetPluginId,
      next.map(({ principalPluginId, path, permissions }) => ({ principalPluginId, path, permissions })),
      expectedRevision,
    );
    const current = selection();
    if (
      requestScopeKey !== scopeKey() ||
      current?.key !== targetKey ||
      current.workspaceGeneration !== workspaceGeneration
    ) {
      return;
    }
    grants.value = result.grants;
    revision.value = result.revision;
  };

  return { grants, revision, loading, load, replace, invalidate, dispose: invalidate };
};
