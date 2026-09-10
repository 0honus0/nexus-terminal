import type { ResolvedSshConnection } from '../../../platform/connection/ssh-connection';
import type { JsonValue, Scope } from '../agent.types';
import type { ToolTargetFingerprint } from './tool-target.types';

export interface AgentConnectionView {
  id: number;
  type: string;
  host: string;
  port: number;
  username: string;
  updatedAt: number;
  configurationHash: string;
}

export interface AgentConnectionResolverPort {
  get(connectionId: number): Promise<AgentConnectionView | null>;
  resolve(connectionId: number): Promise<ResolvedSshConnection>;
}

export interface AgentDiagnosticReport {
  generatedAt: number;
  observations: readonly JsonValue[];
}

export interface AgentDiagnosticsPort {
  run(connectionId: number, probeIds: readonly string[], actorId: string): Promise<AgentDiagnosticReport>;
}

export interface MachineToolContext extends Scope {
  runId: string;
  agentRuntimeId: string;
  signal: AbortSignal;
  deadlineAt: number;
  maxOutputBytes: number;
}

export interface MachineTargetFingerprint extends ToolTargetFingerprint {
  kind: 'machine';
  connectionId: number;
  targetIdentity: string;
  endpoint: string;
  loginUser: string;
  configurationHash: string;
  hostKeyTrust: 'unavailable';
}

export interface BoundedFileResult {
  path: string;
  resolvedPath: string;
  sizeBytes: number;
  modifiedAt: number;
  offset: number;
  bytesRead: number;
  truncated: boolean;
  content: string;
}

export interface FileMutationInspection {
  path: string;
  resolvedPath: string;
  exists: boolean;
  sizeBytes: number | null;
  modifiedAt: number | null;
  mode: number | null;
  sha256: string | null;
}

export interface FileMutationResult extends FileMutationInspection {
  bytesWritten: number;
}

export interface ShellMutationResult {
  exitCode: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface DockerMutationInspection {
  containerId: string;
  state: string;
  image: string;
}

export interface DockerMutationResult extends DockerMutationInspection {
  action: 'start' | 'stop' | 'restart' | 'remove';
  confirmed: boolean;
}

export interface MachineCapabilityPort {
  target(scope: Scope, connectionId: number): Promise<MachineTargetFingerprint>;
  diagnose(
    scope: Scope,
    connectionId: number,
    probeIds: readonly string[],
    actorId: string,
    signal: AbortSignal,
  ): Promise<AgentDiagnosticReport>;
  inspectFile(context: MachineToolContext, connectionId: number, remotePath: string): Promise<FileMutationInspection>;
  writeFile(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
    content: Uint8Array,
    expectedSha256: string | null,
  ): Promise<FileMutationResult>;
  executeShell(
    context: MachineToolContext,
    connectionId: number,
    command: string,
    timeoutSeconds: number,
  ): Promise<ShellMutationResult>;
  inspectDockerContainer(
    context: MachineToolContext,
    connectionId: number,
    containerId: string,
  ): Promise<DockerMutationInspection>;
  mutateDockerContainer(
    context: MachineToolContext,
    connectionId: number,
    containerId: string,
    action: 'start' | 'stop' | 'restart' | 'remove',
    expectedState: string,
  ): Promise<DockerMutationResult>;
  readFile(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
    maxBytes: number,
    offset?: number,
  ): Promise<BoundedFileResult>;
}
