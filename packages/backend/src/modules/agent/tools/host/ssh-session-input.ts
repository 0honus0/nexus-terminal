import type { JsonValue } from '../../agent.types';
import type { AgentTool, ToolContext } from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';

export const sshSessionContext = (input: Record<string, JsonValue>, context: ToolContext): ToolContext => {
  if (input.sessionId === undefined) return context;
  if (input.target !== 'ssh')
    throw new Error('SSH_SESSION_TARGET_MISMATCH', {
      cause: new Error(
        'sessionId identifies an SSH transport, not a Workspace. Omit sessionId for Workspace; command forms remain supported on both targets.',
      ),
    });
  if (
    typeof input.sessionId !== 'string' ||
    input.sessionId.length < 1 ||
    input.sessionId.length > 128 ||
    input.sessionId.includes('\0')
  )
    throw new Error('SSH_SESSION_ID_INVALID', {
      cause: new Error(
        'sessionId must be a non-empty SSH session ID of at most 128 characters without NUL. Use ssh_session_open/list to obtain it.',
      ),
    });
  return { ...context, sshSessionId: input.sessionId };
};

/** Extends canonical file tools without duplicating file inspection/execution semantics. */
export const withSshSessionInput = (tool: AgentTool, cryptoHash: CryptoHashPort): AgentTool => {
  const schema = tool.descriptor.inputSchema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('TOOL_SCHEMA_INVALID');
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties))
    throw new Error('TOOL_SCHEMA_INVALID');
  return {
    ...tool,
    descriptor: {
      ...tool.descriptor,
      description: `${tool.descriptor.description} Optional sessionId uses an existing SSH session; omission uses a temporary connection.`,
      inputSchema: {
        ...schema,
        properties: { ...properties, sessionId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
    },
    inspect: async (input, context, policyRevision) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('TOOL_ARGUMENTS_INVALID');
      const { sessionId, ...args } = input;
      const scoped = sshSessionContext(input, context);
      const inspection = await tool.inspect(args, scoped, policyRevision);
      if (sessionId === undefined) return inspection;
      if (
        !inspection.normalizedArguments ||
        typeof inspection.normalizedArguments !== 'object' ||
        Array.isArray(inspection.normalizedArguments)
      )
        throw new Error('TOOL_STATE_CONFLICT');
      return {
        ...inspection,
        operationHash: hashOperation({ baseOperationHash: inspection.operationHash, sessionId }, cryptoHash),
        normalizedArguments: { ...inspection.normalizedArguments, sessionId },
      };
    },
    execute: (inspection, context) => {
      if (
        !inspection.normalizedArguments ||
        typeof inspection.normalizedArguments !== 'object' ||
        Array.isArray(inspection.normalizedArguments)
      )
        throw new Error('TOOL_STATE_CONFLICT');
      return tool.execute(inspection, sshSessionContext(inspection.normalizedArguments, context));
    },
  };
};
