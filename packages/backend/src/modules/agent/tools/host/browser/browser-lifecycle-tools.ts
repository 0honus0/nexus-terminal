import type { JsonValue } from '../../../agent.types';
import type { BrowserGatewayPort } from '../../../ai/integrations.types';
import type { AgentTool } from '../../../capabilities/tool.types';
import type { BrowserSessionBindingAuthority } from './browser-session-binding-authority';
import {
  MAX_ID_BYTES,
  TOOL_VERSION,
  browserToolObject as object,
  browserToolResult as result,
  browserToolString as string,
} from './browser-tool-common';

export const createBrowserLifecycleTools = (
  authority: BrowserSessionBindingAuthority,
  gateway: BrowserGatewayPort,
): AgentTool[] => [
  {
    descriptor: {
      name: 'browser_create_session',
      version: TOOL_VERSION,
      description:
        'Create a Browser session using either a configured standalone targetId or the Browser target frozen into a running Workspace.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          targetId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          workspaceId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
        },
      },
      riskClass: 'control',
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const binding = await authority.createBinding(context, args);
      const normalized: Record<string, JsonValue> = {
        targetId: binding.target.id,
        targetRevision: binding.target.profileRevision,
        targetConfigurationHash: binding.target.configurationHash,
      };
      if (binding.workspace) {
        normalized.workspaceId = binding.workspace.id;
        normalized.generation = binding.workspace.generation;
      }
      return authority.inspection(
        context,
        'browser_create_session',
        normalized,
        binding,
        undefined,
        'control',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const binding = await authority.revalidateCreate(context, args);
      const session = await gateway.createSession(
        {
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          agentRuntimeId: context.agentRuntimeId,
          target: binding.target,
          ...(binding.workspace ? { workspaceId: binding.workspace.id, generation: binding.workspace.generation } : {}),
        },
        context.signal,
      );
      return result('Browser session created.', session as unknown as JsonValue);
    },
  },
  {
    descriptor: {
      name: 'browser_close',
      version: TOOL_VERSION,
      description: 'Close a Browser session owned by the current Agent runtime.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES } },
        required: ['sessionId'],
      },
      riskClass: 'control',
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const sessionId = string(object(input).sessionId, MAX_ID_BYTES);
      const { binding } = await authority.session(context, sessionId);
      return authority.inspection(
        context,
        'browser_close',
        { sessionId },
        binding,
        sessionId,
        'control',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const sessionId = string(object(value.normalizedArguments).sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      await gateway.close(sessionId);
      return result('Browser session closed.');
    },
  },
];
