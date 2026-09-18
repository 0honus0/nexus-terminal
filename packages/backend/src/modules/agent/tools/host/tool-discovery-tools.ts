import type { JsonValue } from '../../agent.types';
import { ToolCatalog } from '../../capabilities/tool-catalog';
import {
  deferredToolHandle,
  isDeferredToolDescriptor,
  TOOL_SEARCH_NAME,
} from '../../capabilities/tool-model-surface';
import type { AgentTool, ToolContext, ToolDescriptor, ToolInspection, ToolResult } from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';

const MAX_SEARCH_LIMIT = 8;
const MAX_QUERY_BYTES = 512;
const MAX_DESCRIPTION_CHARACTERS = 512;
const MAX_SEARCH_RESULT_BYTES = 24 * 1024;

const asRecord = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

const queryValue = (value: JsonValue | undefined): string => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > MAX_QUERY_BYTES) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value.trim();
};

const limitValue = (value: JsonValue | undefined): number => {
  if (value === undefined) return MAX_SEARCH_LIMIT;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_SEARCH_LIMIT) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return Number(value);
};

const searchTerms = (query: string): string[] =>
  [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_.-]+/gu) ?? [])].slice(0, 12);

const descriptorScore = (descriptor: ToolDescriptor, query: string, terms: readonly string[]): number => {
  const name = descriptor.name.toLowerCase();
  const description = descriptor.description.toLowerCase();
  const exact = query.toLowerCase();
  let score = name === exact ? 1_000 : name.includes(exact) ? 250 : description.includes(exact) ? 120 : 0;
  let matchedTerms = 0;
  for (const term of terms) {
    const inName = name.includes(term);
    const inDescription = description.includes(term);
    if (inName || inDescription) matchedTerms += 1;
    if (inName) score += 50;
    if (inDescription) score += 10;
  }
  if (terms.length > 0 && matchedTerms === 0) return 0;
  return score;
};

export interface DeferredToolSearchResult {
  matches: Array<{
    handle: string;
    name: string;
    version: string;
    description: string;
    inputSchema: JsonValue;
    riskClass: ToolDescriptor['riskClass'];
  }>;
  truncated: boolean;
}

export const searchDeferredTools = (
  catalog: ToolCatalog,
  context: Pick<ToolContext, 'userId' | 'appId' | 'environment' | 'maxOutputBytes'>,
  query: string,
  limit: number,
): DeferredToolSearchResult => {
  const terms = searchTerms(query);
  const ranked = catalog
    .list(context, { environment: context.environment })
    .filter(isDeferredToolDescriptor)
    .map((descriptor) => ({ descriptor, score: descriptorScore(descriptor, query, terms) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.descriptor.name.localeCompare(right.descriptor.name))
    .slice(0, limit);

  const byteBudget = Math.min(MAX_SEARCH_RESULT_BYTES, Math.max(1_024, context.maxOutputBytes - 1_024));
  const matches: DeferredToolSearchResult['matches'] = [];
  let usedBytes = Buffer.byteLength('{"matches":[],"truncated":false}', 'utf8');
  let truncated = false;
  for (const candidate of ranked) {
    const descriptor = candidate.descriptor;
    const match = {
      handle: deferredToolHandle(descriptor),
      name: descriptor.name,
      version: descriptor.version,
      description:
        descriptor.description.length <= MAX_DESCRIPTION_CHARACTERS
          ? descriptor.description
          : `${descriptor.description.slice(0, MAX_DESCRIPTION_CHARACTERS - 1)}…`,
      inputSchema: descriptor.inputSchema,
      riskClass: descriptor.riskClass,
    };
    const bytes = Buffer.byteLength(JSON.stringify(match), 'utf8');
    if (usedBytes + bytes > byteBudget) {
      truncated = true;
      continue;
    }
    matches.push(match);
    usedBytes += bytes;
  }
  if (matches.length < ranked.length) truncated = true;
  return { matches, truncated };
};

export const createToolSearchTool = (catalog: ToolCatalog, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: TOOL_SEARCH_NAME,
    version: '1.0.0',
    description:
      'Search bounded metadata and input schemas for deferred MCP Tools in the current App. Use the returned version-bound handle with tool_invoke. Search is local and deterministic; it does not invoke the remote Tool.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: MAX_QUERY_BYTES },
        limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT },
      },
      required: ['query'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'integration.mcp.invoke',
  },
  inspect: async (input, context, policyRevision): Promise<ToolInspection> => {
    const args = asRecord(input);
    if (Object.keys(args).some((key) => key !== 'query' && key !== 'limit')) throw new Error('TOOL_ARGUMENTS_INVALID');
    const query = queryValue(args.query);
    const limit = limitValue(args.limit);
    const normalizedArguments: JsonValue = { query, limit };
    const configurationHash = hashOperation(
      {
        schemaVersion: 1,
        appId: context.appId,
        discovery: 'deferred-mcp-tool-metadata',
      },
      cryptoHash,
    );
    const target = {
      kind: 'run' as const,
      targetIdentity: `run:${context.runId}:mcp-tool-catalog`,
      endpoint: 'mcp:tool-catalog',
      loginUser: `agent-runtime:${context.agentRuntimeId}`,
      configurationHash,
    };
    const resourceKeys = [`app:${context.appId}:mcp-tool-catalog`];
    return {
      toolName: TOOL_SEARCH_NAME,
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'read',
      mutation: false,
      operationHash: hashOperation(
        {
          schemaVersion: 1,
          scope: {
            userId: context.userId,
            appId: context.appId,
            runId: context.runId,
            agentRuntimeId: context.agentRuntimeId,
          },
          tool: { name: TOOL_SEARCH_NAME, version: '1.0.0' },
          query,
          limit,
          policyRevision,
          inputRevision: context.inputRevision,
        },
        cryptoHash,
      ),
      operationHashVersion: 1,
      preconditions: [],
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context): Promise<ToolResult> => {
    const args = asRecord(inspection.normalizedArguments);
    const query = queryValue(args.query);
    const limit = limitValue(args.limit);
    const result = searchDeferredTools(catalog, context, query, limit);
    return {
      ok: true,
      summary: `Found ${result.matches.length} deferred MCP Tool match${result.matches.length === 1 ? '' : 'es'}.`,
      data: {
        matches: result.matches,
        truncated: result.truncated,
      },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: {
        status: 'verified',
        summary: 'Tool metadata was projected from the current scoped authoritative ToolCatalog.',
        evidenceRefs: [],
      },
    };
  },
});
