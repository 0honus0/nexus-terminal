import { agentApi, type AgentApprovalView, type AgentRunView, type AgentThreadView } from '../api/agent-api';

export const createAgentRunFacade = (appId: string) => ({
  appId,
  listThreads: (before?: string) => agentApi.threads(appId, before),
  createThread: (title?: string) => agentApi.createThread(appId, title),
  readLedger: (threadId: string, before?: string) => agentApi.ledger(appId, threadId, before),
  definitions: () => agentApi.definitions(appId),
  providers: () => agentApi.providers(),
  settings: () => agentApi.settings(),
  listRuns: (threadId?: string) => agentApi.runs(appId, threadId),
  getRun: (runId: string) => agentApi.run(appId, runId),
  listCheckpoints: (runId: string) => agentApi.checkpoints(appId, runId),
  listApprovals: (runId: string) => agentApi.approvals(appId, runId),
  listSubagents: (runId: string, before?: string) => agentApi.subagents(appId, runId, before),
  listSubagentMessages: (runId: string, delegationId: string, before?: string) =>
    agentApi.subagentMessages(appId, runId, delegationId, before),
  cancelSubagent: (runId: string, delegation: Parameters<typeof agentApi.cancelSubagent>[2]) =>
    agentApi.cancelSubagent(appId, runId, delegation),
  resolveApproval: (approval: AgentApprovalView, decision: 'approved' | 'denied') =>
    agentApi.resolveApproval(appId, approval, decision),
  createRun: (input: Parameters<typeof agentApi.createRun>[1]) => agentApi.createRun(appId, input),
  appendInput: (run: AgentRunView, text: string, artifactRefs: string[] = []) =>
    agentApi.appendRunInput(appId, run, text, artifactRefs),
  increaseBudget: (run: AgentRunView, increase: Parameters<typeof agentApi.increaseRunBudget>[2]) =>
    agentApi.increaseRunBudget(appId, run, increase),
  saveCheckpoint: (run: AgentRunView) => agentApi.saveCheckpoint(appId, run),
  resumeRun: (run: AgentRunView, checkpointId: string) => agentApi.resumeRun(appId, run, checkpointId),
  cancelRun: (run: AgentRunView) => agentApi.cancelRun(appId, run),
  selectThread: (thread: AgentThreadView | null) => thread,
});

export type AgentRunFacade = ReturnType<typeof createAgentRunFacade>;
