import { PROTOCOL_VERSION, client, methods, ndJsonStream } from '@agentclientprotocol/sdk';
import type { JsonValue } from '../../../modules/agent/agent.types';
import type {
  AcpExecutionContext,
  AcpExecutionRequest,
  AcpExecutionResult,
  AcpIntegrationConfiguration,
  AcpRuntimePort,
  AcpTransportPort,
  IntegrationView,
} from '../../../modules/agent/ai/integrations.types';

const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_UPDATE_BYTES = 256 * 1024;

const acpConfig = (integration: IntegrationView): AcpIntegrationConfiguration => {
  if (integration.kind !== 'acp' || integration.configuration.transport !== 'workspace-profile') {
    throw new Error('INTEGRATION_KIND_MISMATCH');
  }
  if (integration.configuration.protocolVersion !== String(PROTOCOL_VERSION)) {
    throw new Error('ACP_PROTOCOL_VERSION_UNSUPPORTED');
  }
  return integration.configuration;
};

const boundedJson = (value: unknown, maxBytes: number): JsonValue => {
  let encoded: string;
  try {
    encoded = JSON.stringify(value ?? null);
  } catch {
    throw new Error('ACP_MESSAGE_INVALID');
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) throw new Error('ACP_MESSAGE_TOO_LARGE');
  return JSON.parse(encoded) as JsonValue;
};

const textChunk = (update: unknown): string => {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return '';
  const record = update as Record<string, unknown>;
  if (record.sessionUpdate !== 'agent_message_chunk') return '';
  const content = record.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return '';
  const block = content as Record<string, unknown>;
  return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
};

const assertRequest = (request: AcpExecutionRequest): void => {
  if (
    !request.cwd.startsWith('/workspace') ||
    (request.cwd !== '/workspace' && !request.cwd.startsWith('/workspace/')) ||
    !request.prompt.trim() ||
    Buffer.byteLength(request.prompt, 'utf8') > MAX_PROMPT_BYTES ||
    !Number.isSafeInteger(request.maxOutputBytes) ||
    request.maxOutputBytes < 1 ||
    request.maxOutputBytes > 10 * 1024 * 1024
  ) {
    throw new Error('VALIDATION_FAILED');
  }
};

/**
 * Stable ACP v1 client adapter. The transport is deliberately injected: Nexus
 * only wires transports created inside an isolated Workspace profile. This
 * class never spawns an ACP backend in the Backend process and never grants
 * direct filesystem/terminal access to the remote agent.
 */
export class AcpAdapter implements AcpRuntimePort {
  constructor(private readonly transports: AcpTransportPort) {}

  async execute(
    integration: IntegrationView,
    request: AcpExecutionRequest,
    context: AcpExecutionContext,
  ): Promise<AcpExecutionResult> {
    assertRequest(request);
    if (context.signal.aborted) throw context.signal.reason ?? new Error('ABORTED');
    const config = acpConfig(integration);
    const transport = await this.transports.open(config.profileId, context.signal);
    const onAbort = () => void transport.close().catch(() => undefined);
    context.signal.addEventListener('abort', onAbort, { once: true });

    const app = client({ name: 'nexus-terminal' })
      .onRequest(methods.client.session.requestPermission, async ({ params }) => {
        const decision = await context.requestPermission({
          sessionId: params.sessionId,
          toolCallId: params.toolCall.toolCallId,
          title: params.toolCall.title ?? null,
          kind: params.toolCall.kind ?? null,
          rawInput: params.toolCall.rawInput === undefined ? null : boundedJson(params.toolCall.rawInput, 32 * 1024),
        });
        const desired = decision === 'allow_once' ? 'allow_once' : 'reject_once';
        const option = params.options.find((candidate) => candidate.kind === desired);
        if (!option) return { outcome: { outcome: 'cancelled' as const } };
        return { outcome: { outcome: 'selected' as const, optionId: option.optionId } };
      })
      .onRequest(methods.client.fs.readTextFile, () => {
        throw new Error('ACP_DIRECT_CAPABILITY_DENIED');
      })
      .onRequest(methods.client.fs.writeTextFile, () => {
        throw new Error('ACP_DIRECT_CAPABILITY_DENIED');
      })
      .onRequest(methods.client.terminal.create, () => {
        throw new Error('ACP_DIRECT_CAPABILITY_DENIED');
      })
      .onRequest(methods.client.terminal.output, () => {
        throw new Error('ACP_DIRECT_CAPABILITY_DENIED');
      })
      .onRequest(methods.client.terminal.release, () => {
        throw new Error('ACP_DIRECT_CAPABILITY_DENIED');
      })
      .onRequest(methods.client.terminal.waitForExit, () => {
        throw new Error('ACP_DIRECT_CAPABILITY_DENIED');
      })
      .onRequest(methods.client.terminal.kill, () => {
        throw new Error('ACP_DIRECT_CAPABILITY_DENIED');
      });

    try {
      return await app.connectWith(ndJsonStream(transport.writable, transport.readable), async (agent) =>
        agent.buildSession(request.cwd).withSession(async (session) => {
          const prompt = session.prompt(request.prompt);
          let output = '';
          let stopReason = 'unknown';
          while (true) {
            const message = await session.nextUpdate();
            if (message.kind === 'stop') {
              stopReason = message.stopReason;
              break;
            }
            const update = boundedJson(message.update, MAX_UPDATE_BYTES);
            context.onUpdate?.(update);
            const chunk = textChunk(message.update);
            if (chunk) {
              if (Buffer.byteLength(output + chunk, 'utf8') > request.maxOutputBytes) {
                throw new Error('ACP_OUTPUT_TOO_LARGE');
              }
              output += chunk;
            }
          }
          const response = await prompt;
          if (response.stopReason !== stopReason) throw new Error('ACP_PROTOCOL_STATE_INVALID');
          return { text: output, stopReason };
        }),
      );
    } finally {
      context.signal.removeEventListener('abort', onAbort);
      await transport.close().catch(() => undefined);
    }
  }
}
