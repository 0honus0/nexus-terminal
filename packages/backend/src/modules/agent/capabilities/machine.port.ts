import type { ResolvedSshConnection } from '../../../platform/connection/ssh-connection';
import type { JsonValue, Scope } from '../agent.types';
import type { CanonicalToolTargetFingerprint } from './tool-target.types';

export interface AgentConnectionView {
  id: number;
  name: string | null;
  type: string;
  host: string;
  port: number;
  username: string;
  updatedAt: number;
  configurationHash: string;
}

export interface AgentConnectionResolverPort {
  list(): Promise<AgentConnectionView[]>;
  get(connectionId: number): Promise<AgentConnectionView | null>;
  resolve(connectionId: number, expectedConfigurationHash?: string): Promise<ResolvedSshConnection>;
}

export interface MachineConnectionSummary {
  id: number;
  name: string | null;
  host: string;
  port: number;
  username: string;
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
  connectionIds: readonly number[];
  signal: AbortSignal;
  deadlineAt: number;
  maxOutputBytes: number;
}

export interface SshTargetFingerprint extends CanonicalToolTargetFingerprint {
  kind: 'ssh';
  target: 'ssh';
  connectionId: number;
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

export interface FilePathInspection {
  path: string;
  resolvedPath: string;
  exists: boolean;
  type: 'file' | 'directory' | null;
  sizeBytes: number | null;
  modifiedAt: number | null;
  mode: number | null;
  sha256: string | null;
}

export interface FileMutationInspection extends FilePathInspection {
  type: 'file' | null;
}

export interface FileMutationResult extends FileMutationInspection {
  bytesWritten: number;
}

export interface FileListEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  sizeBytes: number;
  modifiedAt: number;
}

export interface FileListResult {
  path: string;
  entries: FileListEntry[];
  truncated: boolean;
}

export interface FileSearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  before: string[];
  after: string[];
}

export interface FileSearchResult {
  query: string;
  path: string;
  engine: 'sftp';
  matches: FileSearchMatch[];
  truncated: boolean;
  scannedFiles: number;
  scannedBytes: number;
}

export interface FileMoveResult {
  path: string;
  destinationPath: string;
  type: 'file' | 'directory';
  sha256: string | null;
}

export interface FileDeleteResult {
  path: string;
  type: 'file' | 'directory';
  deleted: true;
}

export interface FileReplacement {
  path: string;
  content: Uint8Array;
  expectedSha256: string;
}

export interface FileReplacementResult {
  path: string;
  sha256: string;
  sizeBytes: number;
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
  listConnections(context: MachineToolContext): Promise<MachineConnectionSummary[]>;
  target(context: MachineToolContext, connectionId: number): Promise<SshTargetFingerprint>;
  diagnose(
    context: MachineToolContext,
    connectionId: number,
    probeIds: readonly string[],
    actorId: string,
    signal: AbortSignal,
  ): Promise<AgentDiagnosticReport>;
  inspectPath(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
    expectedConfigurationHash: string,
  ): Promise<FilePathInspection>;
  inspectFile(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
    expectedConfigurationHash: string,
  ): Promise<FileMutationInspection>;
  listFiles(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
    maxEntries: number,
    expectedConfigurationHash: string,
  ): Promise<FileListResult>;
  searchFiles(
    context: MachineToolContext,
    connectionId: number,
    request: {
      query: string;
      path: string;
      glob?: string;
      maxResults: number;
      contextLines: number;
      maxOutputBytes: number;
    },
    expectedConfigurationHash: string,
  ): Promise<FileSearchResult>;
  movePath(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
    destinationPath: string,
    expectedSha256: string | null,
    expectedConfigurationHash: string,
  ): Promise<FileMoveResult>;
  deletePath(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
    recursive: boolean,
    expectedSha256: string | null,
    expectedConfigurationHash: string,
  ): Promise<FileDeleteResult>;
  replaceFiles(
    context: MachineToolContext,
    connectionId: number,
    replacements: readonly FileReplacement[],
    expectedConfigurationHash: string,
  ): Promise<FileReplacementResult[]>;
  writeFile(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
    content: Uint8Array,
    expectedSha256: string | null,
    expectedConfigurationHash: string,
  ): Promise<FileMutationResult>;
  executeShell(
    context: MachineToolContext,
    connectionId: number,
    command: string,
    timeoutSeconds: number,
    expectedConfigurationHash: string,
  ): Promise<ShellMutationResult>;
  inspectDockerContainer(
    context: MachineToolContext,
    connectionId: number,
    containerId: string,
    expectedConfigurationHash: string,
  ): Promise<DockerMutationInspection>;
  mutateDockerContainer(
    context: MachineToolContext,
    connectionId: number,
    containerId: string,
    action: 'start' | 'stop' | 'restart' | 'remove',
    expectedState: string,
    expectedConfigurationHash: string,
  ): Promise<DockerMutationResult>;
  readFile(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
    maxBytes: number,
    offset?: number,
    expectedConfigurationHash?: string,
  ): Promise<BoundedFileResult>;
}
