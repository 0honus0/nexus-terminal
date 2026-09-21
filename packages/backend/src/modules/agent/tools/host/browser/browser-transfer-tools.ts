import type { JsonValue } from '../../../agent.types';
import type { ArtifactService } from '../../../ai/artifact.service';
import type { BrowserGatewayPort } from '../../../ai/integrations.types';
import type { AgentTool, ToolContext } from '../../../capabilities/tool.types';
import type { BrowserSessionBindingAuthority } from './browser-session-binding-authority';
import {
  MAX_ID_BYTES,
  MAX_SETTLE_MS,
  MAX_TRANSFER_BYTES,
  TOOL_VERSION,
  browserByteSource as byteSource,
  browserToolInteger as integer,
  browserToolObject as object,
  browserToolResult as result,
  browserToolString as string,
} from './browser-tool-common';

const artifactBytesForAgent = async (
  artifacts: ArtifactService,
  context: ToolContext,
  artifactId: string,
): Promise<{ id: string; name: string; mediaType: string; sha256: string; sizeBytes: number; bytes: Uint8Array }> => {
  const artifact = await artifacts.getForAgent(
    context,
    { runId: context.runId, runtimeId: context.agentRuntimeId },
    artifactId,
  );
  if (!artifact || artifact.status !== 'ready' || !artifact.sha256) throw new Error('ARTIFACT_NOT_AUTHORIZED_FOR_RUN');
  if (artifact.sizeBytes > MAX_TRANSFER_BYTES) throw new Error('BROWSER_UPLOAD_TOO_LARGE');
  const chunks: Uint8Array[] = [];
  if (artifact.sizeBytes > 0) {
    for await (const chunk of artifacts.readForAgent(
      context,
      { runId: context.runId, runtimeId: context.agentRuntimeId },
      artifact.id,
      { start: 0, endInclusive: artifact.sizeBytes - 1 },
    )) {
      chunks.push(chunk);
    }
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  if (bytes.byteLength !== artifact.sizeBytes) throw new Error('ARTIFACT_UNAVAILABLE');
  return {
    id: artifact.id,
    name: artifact.originalName,
    mediaType: artifact.mediaType,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    bytes,
  };
};

export const createBrowserTransferTools = (
  authority: BrowserSessionBindingAuthority,
  gateway: BrowserGatewayPort,
  artifacts?: ArtifactService,
): AgentTool[] => [
  {
    descriptor: {
      name: 'browser_upload',
      version: TOOL_VERSION,
      description:
        'Upload one Run-authorized Nexus Artifact into an opaque file-input nodeRef. No Backend or Browser host path is accepted.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          snapshotId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          nodeRef: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          artifactId: { type: 'string', minLength: 36, maxLength: 36 },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
        },
        required: ['sessionId', 'snapshotId', 'nodeRef', 'artifactId'],
      },
      riskClass: 'mutate',
      capability: 'browser.interact',
    },
    inspect: async (input, context, policyRevision) => {
      if (!artifacts) throw new Error('BROWSER_ARTIFACT_STORE_UNAVAILABLE');
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const artifactId = string(args.artifactId, 36);
      const source = await artifacts.getForAgent(
        context,
        { runId: context.runId, runtimeId: context.agentRuntimeId },
        artifactId,
      );
      if (!source || source.status !== 'ready' || !source.sha256) throw new Error('ARTIFACT_NOT_AUTHORIZED_FOR_RUN');
      if (source.sizeBytes > MAX_TRANSFER_BYTES) throw new Error('BROWSER_UPLOAD_TOO_LARGE');
      const { binding } = await authority.session(context, sessionId);
      return authority.inspection(
        context,
        'browser_upload',
        {
          sessionId,
          snapshotId: string(args.snapshotId, MAX_ID_BYTES),
          nodeRef: string(args.nodeRef, MAX_ID_BYTES),
          artifactId,
          sourceSha256: source.sha256,
          sourceSizeBytes: source.sizeBytes,
          settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
        },
        binding,
        sessionId,
        'mutate',
        true,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      if (!artifacts) throw new Error('BROWSER_ARTIFACT_STORE_UNAVAILABLE');
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      const source = await artifactBytesForAgent(artifacts, context, string(args.artifactId, 36));
      if (
        source.sha256 !== string(args.sourceSha256, 128) ||
        source.sizeBytes !== integer(args.sourceSizeBytes, -1, 0, MAX_TRANSFER_BYTES)
      ) {
        throw new Error('RESOURCE_CHANGED');
      }
      const state = await gateway.upload(
        sessionId,
        string(args.snapshotId, MAX_ID_BYTES),
        string(args.nodeRef, MAX_ID_BYTES),
        { name: source.name, mediaType: source.mediaType, bytes: source.bytes },
        { settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS) },
        context.signal,
      );
      return {
        ...result('Browser Artifact upload completed.', {
          state: state as unknown as JsonValue,
          sourceArtifact: {
            id: source.id,
            name: source.name,
            mediaType: source.mediaType,
            sha256: source.sha256,
            sizeBytes: source.sizeBytes,
          },
        }),
        artifactRefs: [source.id],
      };
    },
  },
  {
    descriptor: {
      name: 'browser_download',
      version: TOOL_VERSION,
      description:
        'Fetch a download link from the latest Browser snapshot through the live page session, bound bytes, and persist the result as a Nexus Artifact. No Browser host filesystem path is exposed.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          snapshotId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          nodeRef: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          maxBytes: { type: 'integer', minimum: 1, maximum: MAX_TRANSFER_BYTES },
        },
        required: ['sessionId', 'snapshotId', 'nodeRef'],
      },
      riskClass: 'read',
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      if (!artifacts) throw new Error('BROWSER_ARTIFACT_STORE_UNAVAILABLE');
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await authority.session(context, sessionId);
      return authority.inspection(
        context,
        'browser_download',
        {
          sessionId,
          snapshotId: string(args.snapshotId, MAX_ID_BYTES),
          nodeRef: string(args.nodeRef, MAX_ID_BYTES),
          maxBytes: integer(args.maxBytes, MAX_TRANSFER_BYTES, 1, MAX_TRANSFER_BYTES),
        },
        binding,
        sessionId,
        'read',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      if (!artifacts) throw new Error('BROWSER_ARTIFACT_STORE_UNAVAILABLE');
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      const downloaded = await gateway.download(
        sessionId,
        string(args.snapshotId, MAX_ID_BYTES),
        string(args.nodeRef, MAX_ID_BYTES),
        { maxBytes: integer(args.maxBytes, MAX_TRANSFER_BYTES, 1, MAX_TRANSFER_BYTES) },
        context.signal,
      );
      const reservation = await artifacts.begin(context, {
        name: downloaded.name,
        mediaType: downloaded.mediaType,
        declaredBytes: downloaded.bytes.byteLength,
      });
      const artifact = await artifacts.write(
        context,
        reservation.artifactId,
        byteSource(downloaded.bytes),
        context.signal,
      );
      if (artifact.status !== 'ready' || !artifact.sha256) throw new Error('BROWSER_DOWNLOAD_ARTIFACT_UNAVAILABLE');
      return {
        ok: true,
        summary: 'Browser download persisted as a ready Artifact.',
        data: {
          sessionId: downloaded.sessionId,
          targetId: downloaded.targetId,
          generation: downloaded.generation,
          url: downloaded.url,
          artifact: {
            id: artifact.id,
            name: artifact.originalName,
            mediaType: artifact.mediaType,
            sha256: artifact.sha256,
            sizeBytes: artifact.sizeBytes,
          },
        },
        artifactRefs: [artifact.id],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'verified',
          summary:
            'The bounded response bytes were fetched through the live Browser page session and persisted as a ready Artifact.',
          evidenceRefs: [artifact.id],
        },
      };
    },
  },
];
