import { isDeepStrictEqual } from 'node:util';
import type { JsonValue } from '../../agent.types';
import type { McpInputResume } from '../../ai/integrations.types';
import type { ToolResult } from '../../capabilities/tool.types';
import type { UserInputQuestion } from './run.types';

const MAX_CONTINUATION_BYTES = 64 * 1024;
const MAX_INPUT_REQUESTS = 4;

interface McpInputContinuation {
  kind: 'mcp_input_required_v1';
  integrationId: string;
  schemaHash: string;
  method: 'tools/call' | 'resources/read' | 'prompts/get';
  requestParams: JsonValue;
  requestState: string | null;
  inputs: Array<{ questionId: string; inputKey: string }>;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const boundedText = (value: unknown, fallback: string, maxBytes: number): string => {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (Buffer.byteLength(raw, 'utf8') <= maxBytes) return raw;
  return Buffer.from(raw, 'utf8').subarray(0, maxBytes).toString('utf8');
};

export const mcpInputRequestFromToolResult = (
  result: ToolResult,
): { questions: UserInputQuestion[]; continuation: JsonValue } | null => {
  if (
    result.errorCode !== 'MCP_INPUT_REQUIRED' ||
    !result.data ||
    Array.isArray(result.data) ||
    typeof result.data !== 'object'
  ) {
    return null;
  }
  const wrapper = record((result.data as Record<string, unknown>).mcpInputRequired);
  if (!wrapper) return null;
  const integrationId = wrapper.integrationId;
  const schemaHash = wrapper.schemaHash;
  const method = wrapper.method;
  const requestParams = wrapper.requestParams;
  const requestState = wrapper.requestState;
  const inputRequests = record(wrapper.inputRequests);
  if (
    typeof integrationId !== 'string' ||
    typeof schemaHash !== 'string' ||
    (method !== 'tools/call' && method !== 'resources/read' && method !== 'prompts/get') ||
    requestParams === undefined ||
    (requestState !== null && typeof requestState !== 'string') ||
    !inputRequests
  ) {
    throw new Error('MCP_INPUT_REQUIRED_INVALID');
  }
  const entries = Object.entries(inputRequests);
  if (entries.length < 1 || entries.length > MAX_INPUT_REQUESTS) throw new Error('MCP_INPUT_REQUIRED_UNSUPPORTED');
  const questions: UserInputQuestion[] = [];
  const inputs: McpInputContinuation['inputs'] = [];
  for (const [index, [inputKey, request]] of entries.entries()) {
    const requestRecord = record(request);
    if (!requestRecord || requestRecord.method !== 'elicitation/create') {
      throw new Error('MCP_INPUT_REQUEST_UNSUPPORTED');
    }
    const params = record(requestRecord.params);
    if (!params) throw new Error('MCP_INPUT_REQUIRED_INVALID');
    const questionId = `mcp_${index + 1}`;
    const requestedSchema = params.requestedSchema ?? params.schema ?? null;
    const schemaText = JSON.stringify(requestedSchema);
    questions.push({
      id: questionId,
      prompt: boundedText(params.message, 'The MCP server requires additional input.', 1_024),
      kind: 'text',
      context: boundedText(
        `Reply as ${questionId}: <JSON>. Provide either a bare content object matching the requested schema, or an MCP elicitation result such as {"action":"decline"}. Requested schema: ${schemaText}`,
        'Reply with the requested JSON value.',
        1_024,
      ),
    });
    inputs.push({ questionId, inputKey });
  }
  const continuation: McpInputContinuation = {
    kind: 'mcp_input_required_v1',
    integrationId,
    schemaHash,
    method,
    requestParams: JSON.parse(JSON.stringify(requestParams)) as JsonValue,
    requestState,
    inputs,
  };
  if (Buffer.byteLength(JSON.stringify(continuation), 'utf8') > MAX_CONTINUATION_BYTES) {
    throw new Error('MCP_INPUT_REQUIRED_TOO_LARGE');
  }
  return { questions, continuation: continuation as unknown as JsonValue };
};

const lineAnswers = (text: string): Map<string, string> => {
  const answers = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Za-z0-9_.-]{1,64}):\s*(.+)$/u.exec(line.trim());
    if (match) answers.set(match[1]!, match[2]!.trim());
  }
  return answers;
};

export const mcpInputResumeFromAnswer = (continuationValue: JsonValue, answerText: string): McpInputResume => {
  const value = record(continuationValue);
  if (
    !value ||
    value.kind !== 'mcp_input_required_v1' ||
    typeof value.integrationId !== 'string' ||
    typeof value.schemaHash !== 'string' ||
    (value.method !== 'tools/call' && value.method !== 'resources/read' && value.method !== 'prompts/get') ||
    !Array.isArray(value.inputs) ||
    (value.requestState !== null && typeof value.requestState !== 'string')
  ) {
    throw new Error('MCP_INPUT_CONTINUATION_INVALID');
  }
  const answers = lineAnswers(answerText);
  const inputResponses: Record<string, JsonValue> = {};
  for (const input of value.inputs) {
    const mapping = record(input);
    if (!mapping || typeof mapping.questionId !== 'string' || typeof mapping.inputKey !== 'string') {
      throw new Error('MCP_INPUT_CONTINUATION_INVALID');
    }
    let raw = answers.get(mapping.questionId);
    if (raw === undefined && value.inputs.length === 1 && answerText.trim()) raw = answerText.trim();
    if (!raw) throw new Error('MCP_INPUT_RESPONSE_INVALID');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('MCP_INPUT_RESPONSE_INVALID');
    }
    const parsedRecord = record(parsed);
    if (!parsedRecord) throw new Error('MCP_INPUT_RESPONSE_INVALID');
    if (parsedRecord.action === 'accept' || parsedRecord.action === 'decline' || parsedRecord.action === 'cancel') {
      inputResponses[mapping.inputKey] = parsedRecord as JsonValue;
    } else {
      inputResponses[mapping.inputKey] = { action: 'accept', content: parsedRecord as JsonValue };
    }
  }
  return {
    ...(typeof value.requestState === 'string' ? { requestState: value.requestState } : {}),
    inputResponses,
  };
};

export const mcpInputResumeForRequest = (
  continuationValue: JsonValue,
  answerText: string,
  expected: {
    integrationId: string;
    schemaHash: string;
    method: 'tools/call' | 'resources/read' | 'prompts/get';
    requestParams: JsonValue;
  },
): McpInputResume => {
  const value = record(continuationValue);
  if (
    !value ||
    value.integrationId !== expected.integrationId ||
    value.schemaHash !== expected.schemaHash ||
    value.method !== expected.method ||
    !isDeepStrictEqual(value.requestParams, expected.requestParams)
  ) {
    throw new Error('MCP_INPUT_CONTINUATION_MISMATCH');
  }
  return mcpInputResumeFromAnswer(continuationValue, answerText);
};
