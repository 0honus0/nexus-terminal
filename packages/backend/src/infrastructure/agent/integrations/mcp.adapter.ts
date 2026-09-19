import { Client, isInputRequiredResult, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { JsonValue, Scope } from '../../../modules/agent/agent.types';
import type { IntegrationSecretPort } from '../../../modules/agent/ai/integration.repository.port';
import type {
  IntegrationView,
  McpConnectionSnapshot,
  McpInputRequiredResult,
  McpInputResume,
  McpIntegrationConfiguration,
  McpInvocationResult,
  McpPromptGetResult,
  McpResourceReadResult,
  McpRuntimePort,
} from '../../../modules/agent/ai/integrations.types';
import type { OutboundPolicyPort } from '../../../modules/agent/ai/outbound-policy.port';
import { SafeMcpFetch } from './safe-mcp-fetch';

const PROTOCOL_VERSION = '2026-07-28';
const MAX_TOOLS = 256;
const MAX_RESOURCES = 2_048;
const MAX_PROMPTS = 512;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

interface ActiveMcpSession {
  integrationVersion: number;
  credentialRevision: number;
  client: Client;
  safeFetch: SafeMcpFetch;
}

const jsonValue = (value: unknown): JsonValue => {
  const encoded = JSON.stringify(value ?? null);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_OUTPUT_BYTES) throw new Error('MCP_OUTPUT_TOO_LARGE');
  return JSON.parse(encoded) as JsonValue;
};

const mcpConfig = (integration: IntegrationView): McpIntegrationConfiguration => {
  if (integration.kind !== 'mcp' || integration.configuration.transport !== 'streamable-http') {
    throw new Error('INTEGRATION_KIND_MISMATCH');
  }
  return integration.configuration;
};

const inputRequired = (value: unknown): McpInputRequiredResult | null => {
  if (!isInputRequiredResult(value)) return null;
  return {
    kind: 'input_required',
    inputRequests: jsonValue(value.inputRequests ?? {}),
    requestState: value.requestState ?? null,
  };
};

const resumeParams = (resume: McpInputResume | undefined): Record<string, unknown> =>
  resume
    ? {
        inputResponses: resume.inputResponses,
        ...(resume.requestState === undefined ? {} : { requestState: resume.requestState }),
      }
    : {};

export class McpAdapter implements McpRuntimePort {
  private readonly sessions = new Map<string, ActiveMcpSession>();

  constructor(
    private readonly secrets: IntegrationSecretPort,
    private readonly outboundPolicy: OutboundPolicyPort,
  ) {}

  async refresh(integration: IntegrationView, signal?: AbortSignal): Promise<McpConnectionSnapshot> {
    const session = await this.session(integration, signal);
    const capabilities = session.client.getServerCapabilities();
    const [listed, listedResources, listedPrompts] = await Promise.all([
      capabilities?.tools
        ? session.client.listTools(undefined, {
            signal,
            timeout: REQUEST_TIMEOUT_MS,
            cacheMode: 'refresh',
          })
        : Promise.resolve({ tools: [] }),
      capabilities?.resources
        ? session.client.listResources(undefined, {
            signal,
            timeout: REQUEST_TIMEOUT_MS,
            cacheMode: 'refresh',
          })
        : Promise.resolve({ resources: [] }),
      capabilities?.prompts
        ? session.client.listPrompts(undefined, {
            signal,
            timeout: REQUEST_TIMEOUT_MS,
            cacheMode: 'refresh',
          })
        : Promise.resolve({ prompts: [] }),
    ]);
    if (listed.tools.length > MAX_TOOLS) throw new Error('MCP_TOOL_LIMIT_EXCEEDED');
    if (listedResources.resources.length > MAX_RESOURCES) throw new Error('MCP_RESOURCE_LIMIT_EXCEEDED');
    if (listedPrompts.prompts.length > MAX_PROMPTS) throw new Error('MCP_PROMPT_LIMIT_EXCEEDED');
    return {
      serverName: session.client.getServerVersion()?.name ?? 'unknown',
      serverVersion: session.client.getServerVersion()?.version ?? 'unknown',
      protocolVersion: session.client.getNegotiatedProtocolVersion() ?? '',
      tools: listed.tools.map((tool) => ({
        remoteName: tool.name,
        title: tool.title ?? null,
        description: tool.description ?? tool.title ?? tool.name,
        inputSchema: jsonValue(tool.inputSchema),
        outputSchema: tool.outputSchema === undefined ? null : jsonValue(tool.outputSchema),
        annotations: tool.annotations === undefined ? null : jsonValue(tool.annotations),
      })),
      resources: listedResources.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        title: resource.title ?? null,
        description: resource.description ?? resource.title ?? resource.name,
        mimeType: resource.mimeType ?? null,
        annotations: resource.annotations === undefined ? null : jsonValue(resource.annotations),
      })),
      prompts: listedPrompts.prompts.map((prompt) => ({
        name: prompt.name,
        title: prompt.title ?? null,
        description: prompt.description ?? prompt.title ?? prompt.name,
        arguments: (prompt.arguments ?? []).map((argument) => ({
          name: argument.name,
          description: argument.description ?? null,
          required: argument.required === true,
        })),
      })),
    };
  }

  async invoke(
    integration: IntegrationView,
    remoteToolName: string,
    argumentsValue: JsonValue,
    signal: AbortSignal,
    resume?: McpInputResume,
  ): Promise<McpInvocationResult> {
    const session = await this.session(integration, signal);
    const result: unknown = await session.client.callTool(
      {
        name: remoteToolName,
        arguments: argumentsValue as Record<string, unknown>,
        ...resumeParams(resume),
      } as never,
      { signal, timeout: REQUEST_TIMEOUT_MS, allowInputRequired: true },
    );
    const pending = inputRequired(result);
    if (pending) return pending;
    const complete = result as { isError?: boolean; content: unknown; structuredContent?: unknown };
    return {
      kind: 'complete',
      isError: complete.isError === true,
      content: jsonValue(complete.content),
      structuredContent: complete.structuredContent === undefined ? null : jsonValue(complete.structuredContent),
    };
  }

  async readResource(
    integration: IntegrationView,
    uri: string,
    signal: AbortSignal,
    resume?: McpInputResume,
  ): Promise<McpResourceReadResult> {
    const session = await this.session(integration, signal);
    const result: unknown = await session.client.readResource({ uri, ...resumeParams(resume) } as never, {
      signal,
      timeout: REQUEST_TIMEOUT_MS,
      allowInputRequired: true,
      cacheMode: resume ? 'bypass' : 'use',
    });
    const pending = inputRequired(result);
    if (pending) return pending;
    return { kind: 'complete', contents: jsonValue((result as { contents: unknown }).contents) };
  }

  async getPrompt(
    integration: IntegrationView,
    name: string,
    argumentsValue: JsonValue,
    signal: AbortSignal,
    resume?: McpInputResume,
  ): Promise<McpPromptGetResult> {
    const session = await this.session(integration, signal);
    const result: unknown = await session.client.getPrompt(
      {
        name,
        arguments: argumentsValue as Record<string, string>,
        ...resumeParams(resume),
      } as never,
      { signal, timeout: REQUEST_TIMEOUT_MS, allowInputRequired: true },
    );
    const pending = inputRequired(result);
    if (pending) return pending;
    const complete = result as { description?: string; messages: unknown };
    return {
      kind: 'complete',
      description: complete.description ?? null,
      messages: jsonValue(complete.messages),
    };
  }

  async close(integrationId: string): Promise<void> {
    const session = this.sessions.get(integrationId);
    if (!session) return;
    this.sessions.delete(integrationId);
    await session.client.close().catch(() => undefined);
    await session.safeFetch.close();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }

  private async session(integration: IntegrationView, signal?: AbortSignal): Promise<ActiveMcpSession> {
    const current = this.sessions.get(integration.id);
    if (
      current &&
      current.integrationVersion === integration.version &&
      current.credentialRevision === integration.credentialRevision
    ) {
      return current;
    }
    if (current) await this.close(integration.id);
    const config = mcpConfig(integration);
    if (config.protocolVersion !== PROTOCOL_VERSION) throw new Error('MCP_PROTOCOL_VERSION_UNSUPPORTED');
    const scope: Scope = { userId: integration.userId, appId: integration.appId };
    return this.secrets.withCredential(scope, integration.id, integration.credentialRevision, async (credential) => {
      const safeFetch = new SafeMcpFetch(config.endpoint, config.privateHostExceptions, this.outboundPolicy);
      const client = new Client(
        { name: 'nexus-terminal', version: '1.0.0' },
        {
          enforceStrictCapabilities: true,
          listMaxPages: 16,
          versionNegotiation: { mode: { pin: PROTOCOL_VERSION }, probe: { timeoutMs: 10_000, maxRetries: 0 } },
          inputRequired: { autoFulfill: false, maxRounds: 0 },
        },
      );
      const headers: Record<string, string> = { Accept: 'application/json, text/event-stream' };
      if (credential) headers.Authorization = `Bearer ${credential}`;
      const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
        requestInit: { headers },
        fetch: safeFetch.fetch,
        onInsufficientScope: 'throw',
        maxStepUpRetries: 0,
        reconnectionOptions: {
          maxReconnectionDelay: 5_000,
          initialReconnectionDelay: 500,
          reconnectionDelayGrowFactor: 2,
          maxRetries: 2,
        },
      });
      try {
        await client.connect(transport, { signal, timeout: 15_000 });
        const negotiated = client.getNegotiatedProtocolVersion();
        if (negotiated !== PROTOCOL_VERSION) throw new Error('MCP_PROTOCOL_VERSION_UNSUPPORTED');
      } catch (error) {
        await client.close().catch(() => undefined);
        await safeFetch.close();
        throw error;
      }
      const active: ActiveMcpSession = {
        integrationVersion: integration.version,
        credentialRevision: integration.credentialRevision,
        client,
        safeFetch,
      };
      this.sessions.set(integration.id, active);
      return active;
    });
  }
}
