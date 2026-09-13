import type { ArtifactService } from '../../ai/artifact.service';
import type { JsonValue } from '../../agent.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { MachineCapabilityPort } from '../../capabilities/machine.port';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
  ToolPrecondition,
  ToolResult,
} from '../../capabilities/tool.types';

const MAX_WRITE_BYTES = 16 * 1024 * 1024;
const MAX_SHELL_BYTES = 16 * 1024;

const record = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

const onlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error('TOOL_ARGUMENTS_INVALID');
};

const positiveInteger = (value: JsonValue | undefined, fallback?: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as number;
};

const nonNegativeInteger = (value: JsonValue | undefined): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as number;
};

const stringValue = (value: JsonValue | undefined, maxBytes: number): string => {
  if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value;
};

const operation = (
  cryptoHash: CryptoHashPort,
  context: ToolContext,
  name: string,
  version: string,
  target: ToolInspection['target'],
  args: JsonValue,
  resourceKeys: string[],
  preconditions: ToolPrecondition[],
  policyRevision: number,
): string =>
  hashOperation(
    {
      schemaVersion: 1,
      scope: {
        userId: context.userId,
        appId: context.appId,
        runId: context.runId,
        agentRuntimeId: context.agentRuntimeId,
      },
      tool: { name, version },
      target: { ...target },
      arguments: args,
      resourceKeys: [...new Set(resourceKeys)].sort(),
      preconditions: [...preconditions]
        .sort((left, right) => `${left.kind}\u0000${left.key}`.localeCompare(`${right.kind}\u0000${right.key}`))
        .map((precondition) => ({
          kind: precondition.kind,
          key: precondition.key,
          observedValue: precondition.observedValue,
        })),
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    },
    cryptoHash,
  );

const result = (
  ok: boolean,
  summary: string,
  data: JsonValue,
  verificationSummary: string,
  artifactRefs: string[] = [],
  truncated = false,
): ToolResult => ({
  ok,
  summary,
  data,
  artifactRefs,
  truncated,
  outcome: 'confirmed',
  verification: {
    status: ok ? 'verified' : 'failed',
    summary: verificationSummary,
    evidenceRefs: artifactRefs,
  },
});

const readArtifact = async (
  artifacts: ArtifactService,
  context: ToolContext,
  artifactId: string,
  expectedVersion: number,
  expectedSha256: string,
  expectedSize: number,
): Promise<Uint8Array> => {
  const artifact = await artifacts.get(context, artifactId);
  if (
    !artifact ||
    artifact.status !== 'ready' ||
    artifact.version !== expectedVersion ||
    artifact.sha256 !== expectedSha256 ||
    artifact.sizeBytes !== expectedSize
  ) {
    throw new Error('RESOURCE_CHANGED');
  }
  if (artifact.sizeBytes > MAX_WRITE_BYTES) throw new Error('TOOL_INPUT_TOO_LARGE');
  if (artifact.sizeBytes === 0) return new Uint8Array();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of artifacts.read(context, artifactId, { start: 0, endInclusive: artifact.sizeBytes - 1 })) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_WRITE_BYTES || total > artifact.sizeBytes) throw new Error('TOOL_INPUT_TOO_LARGE');
    chunks.push(bytes);
  }
  const content = Buffer.concat(chunks);
  if (content.byteLength !== artifact.sizeBytes) throw new Error('ARTIFACT_UNAVAILABLE');
  return content;
};

export const createWriteFileTool = (
  machine: MachineCapabilityPort,
  artifacts: ArtifactService,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'machine_write_file',
    version: '1.0.0',
    description:
      'Atomically replace or create a bounded remote file from an existing Nexus Artifact. Requires explicit user approval.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        connectionId: { type: 'integer', minimum: 1 },
        path: { type: 'string', minLength: 1, maxLength: 4096 },
        contentArtifactRef: { type: 'string', minLength: 1, maxLength: 128 },
      },
      required: ['connectionId', 'path', 'contentArtifactRef'],
    },
    riskClass: 'mutate',
    capability: 'machine.files.write',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, [
      'connectionId',
      'path',
      'contentArtifactRef',
      'contentArtifactVersion',
      'contentArtifactSha256',
      'contentArtifactBytes',
    ]);
    const connectionId = positiveInteger(args.connectionId);
    const remotePath = stringValue(args.path, 4096);
    const contentArtifactRef = stringValue(args.contentArtifactRef, 128);
    const [target, file, artifact] = await Promise.all([
      machine.target(context, connectionId),
      machine.inspectFile(context, connectionId, remotePath),
      artifacts.get(context, contentArtifactRef),
    ]);
    if (!artifact || artifact.status !== 'ready' || !artifact.sha256 || artifact.sizeBytes > MAX_WRITE_BYTES) {
      throw new Error('ARTIFACT_UNAVAILABLE');
    }
    const normalizedArguments: JsonValue = {
      connectionId,
      path: file.resolvedPath,
      contentArtifactRef,
      contentArtifactVersion: artifact.version,
      contentArtifactSha256: artifact.sha256,
      contentArtifactBytes: artifact.sizeBytes,
    };
    const resourceKeys = [`connection:${connectionId}`, `connection:${connectionId}:file:${file.resolvedPath}`];
    const preconditions: ToolPrecondition[] = [
      {
        kind: 'fileHash',
        key: file.resolvedPath,
        observedValue: file.sha256,
      },
      {
        kind: 'metadata',
        key: file.resolvedPath,
        observedValue: {
          exists: file.exists,
          sizeBytes: file.sizeBytes,
          modifiedAt: file.modifiedAt,
          mode: file.mode,
        },
      },
      {
        kind: 'metadata',
        key: `artifact:${artifact.id}`,
        observedValue: { version: artifact.version, sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
      },
    ];
    return {
      toolName: 'machine_write_file',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'mutate',
      mutation: true,
      operationHash: operation(
        cryptoHash,
        context,
        'machine_write_file',
        '1.0.0',
        target,
        normalizedArguments,
        resourceKeys,
        preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions,
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const artifactId = stringValue(args.contentArtifactRef, 128);
    const artifactVersion = positiveInteger(args.contentArtifactVersion);
    const artifactSha256 = stringValue(args.contentArtifactSha256, 128);
    const artifactBytes = nonNegativeInteger(args.contentArtifactBytes);
    const content = await readArtifact(artifacts, context, artifactId, artifactVersion, artifactSha256, artifactBytes);
    const fileHash = inspection.preconditions.find((precondition) => precondition.kind === 'fileHash')?.observedValue;
    if (fileHash !== null && typeof fileHash !== 'string') throw new Error('TOOL_STATE_CONFLICT');
    const written = await machine.writeFile(
      context,
      positiveInteger(args.connectionId),
      stringValue(args.path, 4096),
      content,
      fileHash as string | null,
    );
    return result(
      true,
      `Wrote ${written.bytesWritten} byte(s) to ${written.resolvedPath}.`,
      {
        path: written.resolvedPath,
        bytesWritten: written.bytesWritten,
        sha256: written.sha256,
        target: { ...inspection.target },
      },
      'The remote file was re-read after atomic replacement and its SHA-256 matched the uploaded Artifact bytes.',
      [artifactId],
    );
  },
});

const shellRisk = (command: string): 'mutate' | 'destructive' | 'forbidden' => {
  if (
    /(^|[;&|]\s*)rm\s+-rf\s+\/(?:\s|$)/i.test(command) ||
    /\/var\/run\/docker\.sock/i.test(command) ||
    /(^|\s)(?:mkfs(?:\.[a-z0-9]+)?|wipefs)\s/i.test(command)
  ) {
    return 'forbidden';
  }
  if (/(^|[;&|]\s*)(?:shutdown|reboot|poweroff)\b/i.test(command) || /\brm\s+-rf\b/i.test(command)) {
    return 'destructive';
  }
  return 'mutate';
};

export const createShellTool = (machine: MachineCapabilityPort, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'machine_execute_shell',
    version: '1.0.0',
    description: 'Execute explicit shell text on an authorized SSH target. Mutations require user approval.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        connectionId: { type: 'integer', minimum: 1 },
        command: { type: 'string', minLength: 1, maxLength: MAX_SHELL_BYTES },
        timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300 },
      },
      required: ['connectionId', 'command'],
    },
    riskClass: 'mutate',
    capability: 'machine.shell.execute',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['connectionId', 'command', 'timeoutSeconds']);
    const connectionId = positiveInteger(args.connectionId);
    const command = stringValue(args.command, MAX_SHELL_BYTES);
    const timeoutSeconds = positiveInteger(
      args.timeoutSeconds,
      Math.min(60, Math.max(1, context.deadlineAt - Math.floor(Date.now() / 1000))),
    );
    const target = await machine.target(context, connectionId);
    const normalizedArguments: JsonValue = { connectionId, command, timeoutSeconds };
    const resourceKeys = [`connection:${connectionId}`];
    const risk = shellRisk(command);
    const preconditions: ToolPrecondition[] = [];
    return {
      toolName: 'machine_execute_shell',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk,
      mutation: risk !== 'forbidden',
      operationHash: operation(
        cryptoHash,
        context,
        'machine_execute_shell',
        '1.0.0',
        target,
        normalizedArguments,
        resourceKeys,
        preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions,
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context) => {
    if (inspection.risk === 'forbidden') throw new Error('RESOURCE_FORBIDDEN');
    const args = record(inspection.normalizedArguments);
    const shell = await machine.executeShell(
      context,
      positiveInteger(args.connectionId),
      stringValue(args.command, MAX_SHELL_BYTES),
      positiveInteger(args.timeoutSeconds),
    );
    const ok = shell.exitCode === 0;
    return result(
      ok,
      ok ? 'Remote shell command completed successfully.' : `Remote shell command exited with code ${shell.exitCode}.`,
      {
        exitCode: shell.exitCode,
        signal: shell.signal,
        stdout: shell.stdout,
        stderr: shell.stderr,
        target: { ...inspection.target },
      },
      ok
        ? 'The SSH command channel returned a confirmed zero exit status.'
        : 'The SSH command channel returned a confirmed non-zero exit status.',
      [],
      shell.truncated,
    );
  },
});

export const createDockerMutationTool = (machine: MachineCapabilityPort, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'machine_docker_action',
    version: '1.0.0',
    description: 'Start, stop, restart, or remove one existing Docker container on an authorized SSH target.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        connectionId: { type: 'integer', minimum: 1 },
        containerId: { type: 'string', pattern: '^[a-fA-F0-9]{12,64}$' },
        action: { type: 'string', enum: ['start', 'stop', 'restart', 'remove'] },
      },
      required: ['connectionId', 'containerId', 'action'],
    },
    riskClass: 'mutate',
    capability: 'machine.docker.mutate',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['connectionId', 'containerId', 'action']);
    const connectionId = positiveInteger(args.connectionId);
    const containerId = stringValue(args.containerId, 64);
    const action = stringValue(args.action, 16);
    if (!['start', 'stop', 'restart', 'remove'].includes(action)) throw new Error('TOOL_ARGUMENTS_INVALID');
    const [target, container] = await Promise.all([
      machine.target(context, connectionId),
      machine.inspectDockerContainer(context, connectionId, containerId),
    ]);
    const normalizedArguments: JsonValue = { connectionId, containerId: container.containerId, action };
    const resourceKeys = [`connection:${connectionId}`, `connection:${connectionId}:docker:${container.containerId}`];
    const preconditions: ToolPrecondition[] = [
      {
        kind: 'serviceState',
        key: `docker:${container.containerId}`,
        observedValue: { state: container.state, image: container.image },
      },
    ];
    const risk = action === 'remove' ? 'destructive' : 'mutate';
    return {
      toolName: 'machine_docker_action',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk,
      mutation: true,
      operationHash: operation(
        cryptoHash,
        context,
        'machine_docker_action',
        '1.0.0',
        target,
        normalizedArguments,
        resourceKeys,
        preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions,
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const precondition = inspection.preconditions.find((candidate) => candidate.kind === 'serviceState');
    if (
      !precondition ||
      !precondition.observedValue ||
      Array.isArray(precondition.observedValue) ||
      typeof precondition.observedValue !== 'object'
    ) {
      throw new Error('TOOL_STATE_CONFLICT');
    }
    const observed = precondition.observedValue as Record<string, JsonValue>;
    if (typeof observed.state !== 'string') throw new Error('TOOL_STATE_CONFLICT');
    const action = stringValue(args.action, 16) as 'start' | 'stop' | 'restart' | 'remove';
    const mutated = await machine.mutateDockerContainer(
      context,
      positiveInteger(args.connectionId),
      stringValue(args.containerId, 64),
      action,
      observed.state,
    );
    return result(
      true,
      `${action} for Docker container ${mutated.containerId} was verified.`,
      {
        containerId: mutated.containerId,
        action,
        state: mutated.state,
        image: mutated.image,
        target: { ...inspection.target },
      },
      action === 'remove'
        ? 'The target container was absent from the post-operation Docker inventory.'
        : 'The post-operation Docker state matched the requested action.',
    );
  },
});
