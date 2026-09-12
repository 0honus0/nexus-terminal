import { agentApi } from '../api/agent-api';
import { agentEvents, type AgentStreamEvent } from '../api/agent-events';
import { createAgentRunFacade, type AgentRunFacade } from '../runtime/run-facade';
import type { PluginFrontendAgentRpcMethod, PluginFrontendRunEvent } from './protocol';

const MAX_TEXT_BYTES = 64_000;
const MAX_LIST_ITEMS = 128;
const encoder = new TextEncoder();

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PLUGIN_AGENT_RPC_INVALID');
  return value as Record<string, unknown>;
};

const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]): void => {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('PLUGIN_AGENT_RPC_INVALID');
};

const string = (value: unknown, maxBytes = 512): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    encoder.encode(value).byteLength > maxBytes ||
    /\0/.test(value)
  ) {
    throw new Error('PLUGIN_AGENT_RPC_INVALID');
  }
  return value;
};

const optionalString = (value: unknown, maxBytes = 512): string | undefined =>
  value === undefined ? undefined : string(value, maxBytes);

const nonNegativeInteger = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('PLUGIN_AGENT_RPC_INVALID');
  return Number(value);
};

const positiveInteger = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('PLUGIN_AGENT_RPC_INVALID');
  return Number(value);
};

const stringArray = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) throw new Error('PLUGIN_AGENT_RPC_INVALID');
  return value.map((item) => string(item));
};

const positiveIntegerArray = (value: unknown): number[] => {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) throw new Error('PLUGIN_AGENT_RPC_INVALID');
  const result = value.map(positiveInteger);
  if (new Set(result).size !== result.length) throw new Error('PLUGIN_AGENT_RPC_INVALID');
  return result;
};

const emptyParams = (value: unknown): void => {
  const params = record(value);
  onlyKeys(params, []);
};

export class PluginAgentSdkDispatcher {
  private readonly runFacade: AgentRunFacade;
  private readonly subscriptions = new Map<string, AbortController>();

  constructor(
    private readonly appId: string,
    private readonly onRunEvent: (event: PluginFrontendRunEvent) => void,
  ) {
    this.runFacade = createAgentRunFacade(appId);
    this.runFacade.start();
  }

  async dispatch(method: PluginFrontendAgentRpcMethod, rawParams: unknown): Promise<unknown> {
    switch (method) {
      case 'agent.definitions.list':
        emptyParams(rawParams);
        return this.runFacade.definitions();
      case 'agent.providers.list':
        emptyParams(rawParams);
        await this.requireGranted('ai.model.use');
        return this.runFacade.providers();
      case 'agent.threads.list': {
        const params = record(rawParams);
        onlyKeys(params, ['before']);
        return this.runFacade.listThreads(optionalString(params.before));
      }
      case 'agent.threads.create': {
        const params = record(rawParams);
        onlyKeys(params, ['title']);
        return this.runFacade.createThread(optionalString(params.title, 4_096));
      }
      case 'agent.threads.entries': {
        const params = record(rawParams);
        onlyKeys(params, ['threadId', 'before']);
        return this.runFacade.readLedger(string(params.threadId), optionalString(params.before));
      }
      case 'agent.runs.list': {
        const params = record(rawParams);
        onlyKeys(params, ['threadId']);
        return this.runFacade.listRuns(optionalString(params.threadId));
      }
      case 'agent.runs.get': {
        const params = record(rawParams);
        onlyKeys(params, ['runId']);
        return this.runFacade.getRun(string(params.runId));
      }
      case 'agent.runs.create': {
        const params = record(rawParams);
        onlyKeys(params, [
          'threadId',
          'text',
          'artifactRefs',
          'agentDefinitionId',
          'model',
          'connectionIds',
          'initialGoal',
        ]);
        await this.requireGranted('runs.execute');
        await this.requireGranted('ai.model.use');
        const model = record(params.model);
        onlyKeys(model, ['providerId', 'modelId', 'configurationVersion']);
        return this.runFacade.createRun({
          threadId: string(params.threadId),
          text: string(params.text, MAX_TEXT_BYTES),
          ...(params.artifactRefs === undefined ? {} : { artifactRefs: stringArray(params.artifactRefs) }),
          agentDefinitionId: string(params.agentDefinitionId),
          model: {
            providerId: string(model.providerId),
            modelId: string(model.modelId),
            configurationVersion: positiveInteger(model.configurationVersion),
          },
          ...(params.connectionIds === undefined ? {} : { connectionIds: positiveIntegerArray(params.connectionIds) }),
          ...(params.initialGoal === undefined ? {} : { initialGoal: string(params.initialGoal, MAX_TEXT_BYTES) }),
        });
      }
      case 'agent.runs.appendInput': {
        const params = record(rawParams);
        onlyKeys(params, ['runId', 'text', 'artifactRefs']);
        await this.requireGranted('runs.execute');
        const run = await this.runFacade.getRun(string(params.runId));
        await this.runFacade.appendInput(
          run,
          string(params.text, MAX_TEXT_BYTES),
          params.artifactRefs === undefined ? [] : stringArray(params.artifactRefs),
        );
        return null;
      }
      case 'agent.runs.cancel': {
        const params = record(rawParams);
        onlyKeys(params, ['runId']);
        await this.requireGranted('runs.execute');
        return this.runFacade.cancelRun(await this.runFacade.getRun(string(params.runId)));
      }
      case 'agent.runs.subscribe': {
        const params = record(rawParams);
        onlyKeys(params, ['runId', 'cursor']);
        const runId = string(params.runId);
        const cursor = params.cursor === undefined ? 0 : nonNegativeInteger(params.cursor);
        return this.subscribe(runId, cursor);
      }
      case 'agent.runs.unsubscribe': {
        const params = record(rawParams);
        onlyKeys(params, ['subscriptionId']);
        this.unsubscribe(string(params.subscriptionId));
        return null;
      }
      case 'agent.subagents.list': {
        const params = record(rawParams);
        onlyKeys(params, ['runId', 'before']);
        return this.runFacade.listSubagents(string(params.runId), optionalString(params.before));
      }
      case 'agent.subagents.messages': {
        const params = record(rawParams);
        onlyKeys(params, ['runId', 'delegationId', 'before']);
        return this.runFacade.listSubagentMessages(
          string(params.runId),
          string(params.delegationId),
          optionalString(params.before),
        );
      }
      case 'agent.subagents.cancel': {
        const params = record(rawParams);
        onlyKeys(params, ['runId', 'delegationId']);
        await this.requireGranted('runs.execute');
        const runId = string(params.runId);
        const delegationId = string(params.delegationId);
        const page = await this.runFacade.listSubagents(runId);
        const delegation = page.items.find((candidate) => candidate.id === delegationId);
        if (!delegation) throw new Error('PLUGIN_AGENT_SUBAGENT_NOT_FOUND');
        return this.runFacade.cancelSubagent(runId, delegation);
      }
      case 'agent.approvals.list': {
        const params = record(rawParams);
        onlyKeys(params, ['runId']);
        return this.runFacade.listApprovals(string(params.runId));
      }
      case 'agent.approvals.resolve': {
        const params = record(rawParams);
        onlyKeys(params, ['approvalId', 'runId', 'decision']);
        await this.requireGranted('runs.execute');
        const runId = string(params.runId);
        const approvalId = string(params.approvalId);
        const decision = params.decision;
        if (decision !== 'approved' && decision !== 'denied') throw new Error('PLUGIN_AGENT_RPC_INVALID');
        const batch = await this.runFacade.listApprovals(runId);
        const approval = batch.items.find((candidate) => candidate.id === approvalId);
        if (!approval) throw new Error('PLUGIN_AGENT_APPROVAL_NOT_FOUND');
        return this.runFacade.resolveApproval(approval, decision);
      }
    }
  }

  private async requireGranted(capability: 'ai.model.use' | 'runs.execute'): Promise<void> {
    const grants = await agentApi.appGrants(this.appId);
    if (!grants.declaredCapabilities.includes(capability)) throw new Error('PLUGIN_CAPABILITY_UNDECLARED');
    if (!grants.grants.some((grant) => grant.capability === capability)) throw new Error('PLUGIN_CAPABILITY_DENIED');
  }

  close(): void {
    for (const controller of this.subscriptions.values()) controller.abort();
    this.subscriptions.clear();
    this.runFacade.dispose();
  }

  private subscribe(runId: string, cursor: number): { subscriptionId: string } {
    const subscriptionId = crypto.randomUUID();
    const controller = new AbortController();
    this.subscriptions.set(subscriptionId, controller);
    void (async () => {
      try {
        for await (const event of agentEvents.run(this.appId, runId, cursor, controller.signal)) {
          if (controller.signal.aborted || !this.subscriptions.has(subscriptionId)) return;
          this.onRunEvent({ subscriptionId, event: event as AgentStreamEvent });
        }
      } catch {
        if (!controller.signal.aborted && this.subscriptions.has(subscriptionId)) {
          this.onRunEvent({
            subscriptionId,
            event: { type: 'transport.disconnected', payload: null },
          });
        }
      } finally {
        if (this.subscriptions.get(subscriptionId) === controller) this.subscriptions.delete(subscriptionId);
      }
    })();
    return { subscriptionId };
  }

  private unsubscribe(subscriptionId: string): void {
    const controller = this.subscriptions.get(subscriptionId);
    if (!controller) return;
    this.subscriptions.delete(subscriptionId);
    controller.abort();
  }
}
