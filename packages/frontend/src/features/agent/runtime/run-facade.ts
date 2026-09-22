import {
  agentApi,
  type AgentApprovalViewDto,
  type AgentRunReconciliationViewDto,
  type AgentRunSnapshotDto,
  type AgentRunViewDto,
} from '../api/agent-api';
import { agentEvents, type AgentStreamEvent } from '../api/agent-events';
import { createAgentRunStore } from './run-store';

const MAX_SNAPSHOT_REFRESH_ATTEMPTS = 3;

export interface AgentRunSubscriptionHandlers {
  onEvent(event: AgentStreamEvent, signal: AbortSignal): Promise<void> | void;
  onError?(cause: unknown): void;
}

export const createAgentRunFacade = (appId: string) => {
  const runStore = createAgentRunStore();
  const refreshTails = new Map<string, Promise<void>>();
  let started = false;
  let disposed = false;
  let subscriptionAbort: AbortController | null = null;
  let subscriptionGeneration = 0;

  const currentRun = (run: AgentRunViewDto): AgentRunViewDto => runStore.latest(run.id) ?? run;

  const refreshSnapshot = (runId: string, minimumEventCursor = 0): Promise<AgentRunSnapshotDto> => {
    const previous = refreshTails.get(runId) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        if (disposed) throw new Error('AGENT_RUN_FACADE_DISPOSED');
        if (minimumEventCursor > 0) {
          const cached = runStore.currentSnapshot(runId);
          if (cached && cached.eventCursor >= minimumEventCursor) return cached;
        }

        for (let attempt = 0; attempt < MAX_SNAPSHOT_REFRESH_ATTEMPTS; attempt += 1) {
          const candidate = await agentApi.run(appId, runId);
          if (disposed) throw new Error('AGENT_RUN_FACADE_DISPOSED');
          const accepted = runStore.acceptSnapshot(candidate);
          if (accepted && accepted.eventCursor >= minimumEventCursor) return accepted;
          const current = runStore.currentSnapshot(runId);
          if (current && current.eventCursor >= minimumEventCursor) return current;
        }
        throw new Error('AGENT_RUN_SNAPSHOT_STALE');
      });
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    refreshTails.set(runId, tail);
    void tail.finally(() => {
      if (refreshTails.get(runId) === tail) refreshTails.delete(runId);
    });
    return task;
  };

  const stopSubscription = (): void => {
    subscriptionGeneration += 1;
    subscriptionAbort?.abort();
    subscriptionAbort = null;
  };

  const start = (): void => {
    if (disposed) throw new Error('AGENT_RUN_FACADE_DISPOSED');
    started = true;
  };

  const selectRun = (run: AgentRunViewDto | null, handlers?: AgentRunSubscriptionHandlers): void => {
    stopSubscription();
    if (!run) return;
    if (!started || disposed) throw new Error('AGENT_RUN_FACADE_NOT_STARTED');
    if (!handlers) throw new Error('AGENT_RUN_SUBSCRIPTION_HANDLERS_REQUIRED');

    const controller = new AbortController();
    subscriptionAbort = controller;
    const generation = ++subscriptionGeneration;
    void (async () => {
      try {
        for await (const event of agentEvents.run(appId, run.id, run.eventCursor, controller.signal)) {
          if (controller.signal.aborted || generation !== subscriptionGeneration) return;
          await handlers.onEvent(event, controller.signal);
          if (controller.signal.aborted || generation !== subscriptionGeneration) return;
        }
      } catch (cause) {
        if (controller.signal.aborted || generation !== subscriptionGeneration) return;
        handlers.onError?.(cause);
      }
    })();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    started = false;
    stopSubscription();
    refreshTails.clear();
    runStore.clear();
  };

  return {
    appId,
    start,
    selectRun,
    dispose,
    listThreads: (before?: string, limit = 50) => agentApi.threads(appId, before, limit),
    createThread: (title?: string) => agentApi.createThread(appId, title),
    renameThread: (threadId: string, title: string, expectedVersion: number) =>
      agentApi.renameThread(appId, threadId, title, expectedVersion),
    deleteThread: (thread: Parameters<typeof agentApi.deleteThread>[1]) => agentApi.deleteThread(appId, thread),
    deleteAllThreads: () => agentApi.deleteAllThreads(appId),
    readLedger: (threadId: string, before?: string) => agentApi.ledger(appId, threadId, before),
    definitions: () => agentApi.definitions(appId),
    providers: () => agentApi.providers(),
    settings: () => agentApi.settings(),
    listRuns: async (threadId?: string) => {
      const page = await agentApi.runs(appId, threadId);
      return { ...page, items: page.items.map((run) => runStore.accept(run)) };
    },
    getRun: (runId: string, minimumEventCursor = 0) => refreshSnapshot(runId, minimumEventCursor),
    getReconciliation: (runId: string) => agentApi.runReconciliation(appId, runId),
    resolveReconciliation: async (run: AgentRunViewDto, reconciliation: AgentRunReconciliationViewDto, note: string) =>
      runStore.accept(await agentApi.resolveRunReconciliation(appId, currentRun(run), reconciliation, note)),
    listCheckpoints: (runId: string) => agentApi.checkpoints(appId, runId),
    listApprovals: (runId: string) => agentApi.approvals(appId, runId),
    listSubagents: (runId: string, before?: string) => agentApi.subagents(appId, runId, before),
    listSubagentMessages: (runId: string, delegationId: string, before?: string) =>
      agentApi.subagentMessages(appId, runId, delegationId, before),
    cancelSubagent: (runId: string, delegation: Parameters<typeof agentApi.cancelSubagent>[2]) =>
      agentApi.cancelSubagent(appId, runId, delegation),
    resolveApproval: (approval: AgentApprovalViewDto, decision: 'approved' | 'denied', feedback?: string) =>
      agentApi.resolveApproval(appId, approval, decision, feedback),
    createRun: async (input: Parameters<typeof agentApi.createRun>[1]) =>
      runStore.accept(await agentApi.createRun(appId, input)),
    appendInput: (run: AgentRunViewDto, text: string, artifactRefs: string[] = []) =>
      agentApi.appendRunInput(appId, currentRun(run), text, artifactRefs),
    interrupt: (run: AgentRunViewDto, text: string) => agentApi.interruptRun(appId, currentRun(run), text),
    setGoal: async (run: AgentRunViewDto, text: string) =>
      runStore.accept(await agentApi.setRunGoal(appId, currentRun(run), text)),
    pendingInputs: (runId: string) => agentApi.pendingRunInputs(appId, runId),
    mutatePendingInput: async (
      run: AgentRunViewDto,
      action: 'remove' | 'move',
      inputId: string,
      beforeInputId: string | null,
    ) => runStore.accept(await agentApi.mutatePendingRunInput(appId, currentRun(run), action, inputId, beforeInputId)),
    increaseBudget: async (run: AgentRunViewDto, increase: Parameters<typeof agentApi.increaseRunBudget>[2]) =>
      runStore.accept(await agentApi.increaseRunBudget(appId, currentRun(run), increase)),
    saveCheckpoint: (run: AgentRunViewDto) => agentApi.saveCheckpoint(appId, currentRun(run)),
    resumeRun: async (run: AgentRunViewDto, checkpointId: string) =>
      runStore.accept(await agentApi.resumeRun(appId, currentRun(run), checkpointId)),
    cancelRun: async (run: AgentRunViewDto) => runStore.accept(await agentApi.cancelRun(appId, currentRun(run))),
    deleteRun: (run: AgentRunViewDto) => agentApi.deleteRun(appId, currentRun(run)),
  };
};

export type AgentRunFacade = ReturnType<typeof createAgentRunFacade>;
