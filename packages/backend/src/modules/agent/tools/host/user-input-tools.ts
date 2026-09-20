import type { JsonValue } from '../../agent.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { AgentTool, ToolInspection, ToolResult } from '../../capabilities/tool.types';
import { normalizeUserInputQuestions, userInputQuestionsJson } from '../../runtime/runs/user-input-request';

const asRecord = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

export const createRequestUserInputTool = (cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'request_user_input',
    version: '1.0.0',
    description:
      'Ask the user for missing information that is necessary to continue this Run. Use only when proceeding would require an unsafe or material guess. The Run will pause durably until the user replies.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$' },
              prompt: { type: 'string', minLength: 1, maxLength: 1024 },
              kind: { type: 'string', enum: ['text', 'choice'] },
              choices: {
                type: 'array',
                minItems: 2,
                maxItems: 8,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    value: { type: 'string', minLength: 1, maxLength: 128 },
                    label: { type: 'string', minLength: 1, maxLength: 256 },
                    description: { type: 'string', minLength: 1, maxLength: 512 },
                  },
                  required: ['value', 'label'],
                },
              },
              recommendedChoice: { type: 'string', minLength: 1, maxLength: 128 },
              context: { type: 'string', minLength: 1, maxLength: 1024 },
            },
            required: ['id', 'prompt', 'kind'],
          },
        },
      },
      required: ['questions'],
    },
    riskClass: 'control',
  },
  inspect: async (input, context, policyRevision): Promise<ToolInspection> => {
    const args = asRecord(input);
    if (Object.keys(args).some((key) => key !== 'questions')) throw new Error('TOOL_ARGUMENTS_INVALID');
    let questions;
    try {
      questions = normalizeUserInputQuestions(args.questions);
    } catch {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    const normalizedArguments = { questions: userInputQuestionsJson(questions) } satisfies JsonValue;
    const target = {
      kind: 'run' as const,
      targetIdentity: `run:${context.runId}`,
      endpoint: `run:${context.runId}:user-input`,
      loginUser: `agent-runtime:${context.agentRuntimeId}`,
      configurationHash: hashOperation({ schemaVersion: 1, runId: context.runId }, cryptoHash),
    };
    return {
      toolName: 'request_user_input',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys: [`run:${context.runId}:user-input`],
      risk: 'control',
      mutation: false,
      operationHash: hashOperation(
        {
          schemaVersion: 1,
          runId: context.runId,
          runtimeId: context.agentRuntimeId,
          questions: userInputQuestionsJson(questions),
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
  execute: async (inspection): Promise<ToolResult> => {
    if (inspection.toolName !== 'request_user_input') throw new Error('TOOL_STATE_CONFLICT');
    const args = asRecord(inspection.normalizedArguments);
    const questions = normalizeUserInputQuestions(args.questions);
    return {
      ok: true,
      summary: `Waiting for the user to answer ${questions.length} clarification question(s).`,
      data: { request: { questions: userInputQuestionsJson(questions) } },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: {
        status: 'verified',
        summary: 'The clarification request is ready to be committed durably.',
        evidenceRefs: [],
      },
    };
  },
});
