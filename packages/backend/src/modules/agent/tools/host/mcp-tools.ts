import type { JsonValue, Scope } from '../../agent.types';
import type { IntegrationRepositoryPort } from '../../ai/integration.repository.port';
import type { IntegrationView, McpRuntimePort, McpToolDescriptor } from '../../ai/integrations.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { AgentTool, ToolContext, ToolInspection, ToolResult } from '../../capabilities/tool.types';

const MAX_TOOL_NAME_BYTES = 64;

const slug = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30) || 'tool';

const toolName = (integrationId: string, remoteName: string, cryptoHash: CryptoHashPort): string => {
  const short = integrationId.replace(/-/g, '').slice(0, 8);
  const suffix = cryptoHash.sha256Utf8(remoteName).slice(0, 8);
  const candidate = `mcp_${short}_${slug(remoteName)}_${suffix}`;
  return Buffer.byteLength(candidate, 'utf8') <= MAX_TOOL_NAME_BYTES ? candidate : `mcp_${short}_${suffix}`;
};

const currentIntegration = async (
  repository: IntegrationRepositoryPort,
  scope: Scope,
  integrationId: string,
  schemaHash: string,
): Promise<IntegrationView> => {
  const integration = await repository.get(scope, integrationId);
  if (!integration || integration.kind !== 'mcp' || !integration.enabled) throw new Error('INTEGRATION_NOT_FOUND');
  if (integration.schemaHash !== schemaHash) throw new Error('RESOURCE_CHANGED');
  return integration;
};

export const createMcpTools = (
  scope: Scope,
  integration: IntegrationView,
  schemaHash: string,
  descriptors: readonly McpToolDescriptor[],
  repository: IntegrationRepositoryPort,
  runtime: McpRuntimePort,
  cryptoHash: CryptoHashPort,
): AgentTool[] =>
  descriptors.map((descriptor): AgentTool => {
    const localName = toolName(integration.id, descriptor.remoteName, cryptoHash);
    return {
      descriptor: {
        name: localName,
        version: `mcp:${schemaHash.slice(3, 15)}`,
        description: `[MCP ${integration.configuration.displayName}] ${descriptor.description}`.slice(0, 1024),
        inputSchema: descriptor.inputSchema,
        riskClass: 'mutate',
        capability: 'integration.mcp.invoke',
      },
      inspect: async (input: JsonValue, context: ToolContext, policyRevision: number): Promise<ToolInspection> => {
        if (context.userId !== scope.userId || context.appId !== scope.appId) throw new Error('RESOURCE_FORBIDDEN');
        const fresh = await currentIntegration(repository, scope, integration.id, schemaHash);
        const configurationHash = hashOperation(
          {
            schemaVersion: 1,
            integrationId: fresh.id,
            integrationVersion: fresh.version,
            credentialRevision: fresh.credentialRevision,
            schemaHash,
            remoteToolName: descriptor.remoteName,
            inputSchema: descriptor.inputSchema,
            outputSchema: descriptor.outputSchema,
          },
          cryptoHash,
        );
        const target: ToolInspection['target'] = {
          kind: 'integration',
          integrationId: fresh.id,
          schemaHash,
          targetIdentity: `mcp:${fresh.id}:${descriptor.remoteName}:${schemaHash}`,
          endpoint: fresh.configuration.transport === 'streamable-http' ? fresh.configuration.endpoint : 'mcp:invalid',
          loginUser: 'mcp-client',
          configurationHash,
        };
        const resourceKeys = [`integration:mcp:${fresh.id}:${descriptor.remoteName}`];
        const preconditions: ToolInspection['preconditions'] = [
          { kind: 'metadata', key: `integration:${fresh.id}:schema`, observedValue: schemaHash },
          { kind: 'metadata', key: `integration:${fresh.id}:version`, observedValue: fresh.version },
        ];
        const normalizedArguments = JSON.parse(JSON.stringify(input)) as JsonValue;
        const operation = hashOperation(
          {
            schemaVersion: 1,
            scope: {
              userId: context.userId,
              appId: context.appId,
              runId: context.runId,
              agentRuntimeId: context.agentRuntimeId,
            },
            tool: { name: localName, version: `mcp:${schemaHash.slice(3, 15)}`, remoteName: descriptor.remoteName },
            target: {
              integrationId: fresh.id,
              schemaHash,
              configurationHash,
            },
            arguments: normalizedArguments,
            resourceKeys,
            preconditions: preconditions.map((item) => ({
              kind: item.kind,
              key: item.key,
              observedValue: item.observedValue,
            })),
            policyRevision,
            inputRevision: context.inputRevision,
          },
          cryptoHash,
        );
        return {
          toolName: localName,
          toolVersion: `mcp:${schemaHash.slice(3, 15)}`,
          normalizedArguments,
          target,
          resourceKeys,
          risk: 'mutate',
          mutation: true,
          operationHash: operation,
          operationHashVersion: 1,
          preconditions,
          secretRefs: [],
          policyRevision,
          inputRevision: context.inputRevision,
        };
      },
      execute: async (inspection: ToolInspection, context: ToolContext): Promise<ToolResult> => {
        const fresh = await currentIntegration(repository, context, integration.id, schemaHash);
        try {
          const result = await runtime.invoke(
            fresh,
            descriptor.remoteName,
            inspection.normalizedArguments,
            context.signal,
          );
          return {
            ok: !result.isError,
            summary: result.isError
              ? `MCP tool ${descriptor.remoteName} reported an error.`
              : `MCP tool ${descriptor.remoteName} completed.`,
            data: { content: result.content, structuredContent: result.structuredContent },
            artifactRefs: [],
            truncated: false,
            outcome: 'confirmed',
            ...(result.isError ? { errorCode: 'MCP_TOOL_ERROR' } : {}),
            verification: {
              status: 'unverified',
              summary:
                'The MCP server response confirms protocol completion but is not independent verification of external side effects.',
              evidenceRefs: [],
            },
          };
        } catch (error) {
          return {
            ok: false,
            summary: error instanceof Error ? error.message.slice(0, 512) : 'MCP invocation outcome is unknown.',
            artifactRefs: [],
            truncated: false,
            outcome: 'unknown',
            errorCode: 'MCP_OUTCOME_UNKNOWN',
            verification: {
              status: 'unverified',
              summary: 'MCP transport did not confirm the external outcome.',
              evidenceRefs: [],
            },
          };
        }
      },
    };
  });
