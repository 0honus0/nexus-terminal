import { createHash } from 'node:crypto';
import type { AgentTool } from '../../capabilities/tool.types';
import type { ToolResultReaderPort } from '../../runtime/runs/run.repository.port';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';

/** Uses the durable result owner rather than duplicating captured output in a file store. */
export const createToolResultReadTool = (results: ToolResultReaderPort, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'tool_result_read',
    version: '1.0.0',
    description:
      'Read a bounded page of the captured durable result for a Tool call from this runtime. Use projection.toolCallId and projection.sha256 from a truncated result. offset and nextOffset count Unicode characters, not bytes. This does not recover output omitted by execution capture limits.',
    riskClass: 'read',
    parallelSafe: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        toolCallId: { type: 'string', minLength: 1, maxLength: 128 },
        sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        offset: { type: 'integer', minimum: 0, maximum: 100000000 },
        maxBytes: { type: 'integer', minimum: 1, maximum: 16384 },
      },
      required: ['toolCallId', 'sha256'],
    },
  },
  inspect: async (input, context, policyRevision) => {
    if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
    const args = {
      toolCallId: input.toolCallId,
      sha256: input.sha256,
      offset: input.offset ?? 0,
      maxBytes: input.maxBytes ?? 4096,
    };
    const target = {
      kind: 'run' as const,
      targetIdentity: context.runId,
      endpoint: `run:${context.runId}`,
      loginUser: context.agentRuntimeId,
      configurationHash: hashOperation({ runId: context.runId, runtimeId: context.agentRuntimeId }, cryptoHash),
    };
    return {
      toolName: 'tool_result_read',
      toolVersion: '1.0.0',
      normalizedArguments: args,
      target,
      resourceKeys: [`tool-result:${args.toolCallId}`],
      risk: 'read',
      mutation: false,
      operationHash: hashOperation(
        {
          ...args,
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          runtimeId: context.agentRuntimeId,
          policyRevision,
        },
        cryptoHash,
      ),
      operationHashVersion: 1,
      preconditions: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context) => {
    const args = inspection.normalizedArguments;
    if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
    const result = await results.toolResult(context, context.runId, context.agentRuntimeId, String(args.toolCallId));
    if (!result) throw new Error('RESOURCE_FORBIDDEN');
    const text = result;
    const sha256 = createHash('sha256').update(text).digest('hex');
    if (sha256 !== args.sha256) throw new Error('RESOURCE_CHANGED');
    const characters = Array.from(text);
    const offset = Number(args.offset);
    if (offset > characters.length) throw new Error('TOOL_ARGUMENTS_INVALID');
    // Reserve the envelope and JSON escaping overhead before allowing the caller's page size.
    const pageBudget = Math.min(Number(args.maxBytes), Math.max(0, context.maxOutputBytes - 700));
    let page = '';
    let nextOffset = offset;
    while (nextOffset < characters.length) {
      const candidate = page + characters[nextOffset];
      if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > pageBudget) break;
      page = candidate;
      nextOffset += 1;
    }
    if (nextOffset === offset && offset < characters.length) throw new Error('CONTEXT_BUDGET_EXCEEDED');
    return {
      ok: true,
      summary: 'Captured Tool result page.',
      data: {
        toolCallId: args.toolCallId,
        sha256,
        originalBytes: Buffer.byteLength(text),
        offset,
        nextOffset: nextOffset < characters.length ? nextOffset : null,
        text: page,
      },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: {
        status: 'verified',
        summary: 'Read captured durable bytes; this does not upgrade the original Tool outcome.',
        evidenceRefs: [],
      },
    };
  },
});
