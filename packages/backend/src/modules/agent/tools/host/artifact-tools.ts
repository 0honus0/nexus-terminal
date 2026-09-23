import type { ArtifactService } from '../../ai/artifact.service';
import { readArtifactByteRangeForAgent, readArtifactTextLinesForAgent } from '../../ai/artifact-model-projection';
import type { JsonValue } from '../../agent.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { AgentTool, ToolInspection, ToolResult, ToolUserSummary } from '../../capabilities/tool.types';

const record = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

const onlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error('TOOL_ARGUMENTS_INVALID');
};

const integer = (value: JsonValue | undefined, fallback: number, minimum: number, maximum: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value as number;
};

const metadata = (artifact: {
  id: string;
  appId: string;
  originalName: string;
  mediaType: string;
  sha256: string | null;
  sizeBytes: number;
  version: number;
}): JsonValue => ({
  id: artifact.id,
  sourceAppId: artifact.appId,
  name: artifact.originalName,
  mediaType: artifact.mediaType,
  sha256: artifact.sha256,
  sizeBytes: artifact.sizeBytes,
  version: artifact.version,
});

const result = (summary: string, data: JsonValue, artifactId: string, userSummary?: ToolUserSummary): ToolResult => ({
  ok: true,
  summary,
  ...(userSummary ? { userSummary } : {}),
  data,
  artifactRefs: [artifactId],
  truncated: false,
  outcome: 'confirmed',
  verification: {
    status: 'verified',
    summary: 'Artifact bytes were read through the current Run/runtime authorization boundary.',
    evidenceRefs: [artifactId],
  },
});

export const createArtifactReadTool = (artifacts: ArtifactService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'artifact_read',
    version: '1.0.0',
    description:
      'Read metadata, a bounded UTF-8 line range, or a bounded base64 byte range from an Artifact authorized for this Run. Child agents can read only explicitly delegated input Artifacts.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        artifactId: { type: 'string', minLength: 36, maxLength: 36 },
        mode: { type: 'string', enum: ['metadata', 'text', 'bytes'] },
        startLine: { type: 'integer', minimum: 1 },
        lineCount: { type: 'integer', minimum: 1, maximum: 200 },
        startByte: { type: 'integer', minimum: 0 },
        maxBytes: { type: 'integer', minimum: 1, maximum: 49152 },
      },
      required: ['artifactId', 'mode'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'artifacts.read',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['artifactId', 'mode', 'startLine', 'lineCount', 'startByte', 'maxBytes']);
    if (typeof args.artifactId !== 'string' || !args.artifactId) throw new Error('TOOL_ARGUMENTS_INVALID');
    if (args.mode !== 'metadata' && args.mode !== 'text' && args.mode !== 'bytes') {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    let normalizedArguments: JsonValue;
    if (args.mode === 'metadata') {
      if (
        args.startLine !== undefined ||
        args.lineCount !== undefined ||
        args.startByte !== undefined ||
        args.maxBytes !== undefined
      ) {
        throw new Error('TOOL_ARGUMENTS_INVALID');
      }
      normalizedArguments = { artifactId: args.artifactId, mode: 'metadata' };
    } else if (args.mode === 'text') {
      if (args.startByte !== undefined || args.maxBytes !== undefined) throw new Error('TOOL_ARGUMENTS_INVALID');
      normalizedArguments = {
        artifactId: args.artifactId,
        mode: 'text',
        startLine: integer(args.startLine, 1, 1, 1_000_000),
        lineCount: integer(args.lineCount, 100, 1, 200),
      };
    } else {
      if (args.startLine !== undefined || args.lineCount !== undefined) throw new Error('TOOL_ARGUMENTS_INVALID');
      normalizedArguments = {
        artifactId: args.artifactId,
        mode: 'bytes',
        startByte: integer(args.startByte, 0, 0, Number.MAX_SAFE_INTEGER),
        maxBytes: integer(args.maxBytes, 16 * 1024, 1, 48 * 1024),
      };
    }
    const target: ToolInspection['target'] = {
      kind: 'run',
      targetIdentity: `artifact:${args.artifactId}`,
      endpoint: `run:${context.runId}:artifact:${args.artifactId}`,
      loginUser: `agent-runtime:${context.agentRuntimeId}`,
      configurationHash: hashOperation(
        {
          schemaVersion: 1,
          runId: context.runId,
          runtimeId: context.agentRuntimeId,
          artifactId: args.artifactId,
        },
        cryptoHash,
      ),
    };
    const resourceKeys = [`artifact:${args.artifactId}`];
    return {
      toolName: 'artifact_read',
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
          tool: { name: 'artifact_read', version: '1.0.0' },
          artifact: { id: args.artifactId, runId: context.runId, runtimeId: context.agentRuntimeId },
          arguments: normalizedArguments,
          resourceKeys,
          preconditions: [],
          policyRevision,
          inputRevision: context.inputRevision,
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
    const args = record(inspection.normalizedArguments);
    const artifactId = String(args.artifactId);
    const access = { runId: context.runId, runtimeId: context.agentRuntimeId };
    if (args.mode === 'metadata') {
      const artifact = await artifacts.getForAgent(context, access, artifactId);
      if (!artifact || artifact.status !== 'ready') throw new Error('ARTIFACT_NOT_AUTHORIZED_FOR_RUN');
      return result(
        `Artifact metadata: ${artifact.originalName} (${artifact.sizeBytes} bytes).`,
        metadata(artifact),
        artifact.id,
        {
          key: 'agent.conversation.toolSummary.artifactMetadata',
          params: { name: artifact.originalName, bytes: artifact.sizeBytes },
        },
      );
    }
    if (args.mode === 'text') {
      const read = await readArtifactTextLinesForAgent(
        artifacts,
        context,
        access,
        artifactId,
        Number(args.startLine),
        Number(args.lineCount),
      );
      return result(
        `Read Artifact lines ${read.startLine}-${read.endLine} from ${read.artifact.originalName}.`,
        {
          artifact: metadata(read.artifact),
          startLine: read.startLine,
          endLine: read.endLine,
          scannedBytes: read.scannedBytes,
          completeScan: read.complete,
          text: read.text,
        },
        read.artifact.id,
        {
          key: 'agent.conversation.toolSummary.artifactLinesRead',
          params: { name: read.artifact.originalName, start: read.startLine, end: read.endLine },
        },
      );
    }
    const read = await readArtifactByteRangeForAgent(
      artifacts,
      context,
      access,
      artifactId,
      Number(args.startByte),
      Number(args.maxBytes),
    );
    return result(
      `Read Artifact bytes ${read.startByte}-${read.endByte} from ${read.artifact.originalName}.`,
      {
        artifact: metadata(read.artifact),
        startByte: read.startByte,
        endByte: read.endByte,
        encoding: 'base64',
        data: read.bytes.toString('base64'),
      },
      read.artifact.id,
      {
        key: 'agent.conversation.toolSummary.artifactBytesRead',
        params: { name: read.artifact.originalName, start: read.startByte, end: read.endByte },
      },
    );
  },
});
