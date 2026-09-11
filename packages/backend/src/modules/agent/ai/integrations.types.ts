import type { JsonValue, Scope } from '../agent.types';

export type IntegrationKind = 'mcp' | 'acp';

export interface McpIntegrationConfiguration {
  displayName: string;
  transport: 'streamable-http';
  endpoint: string;
  privateHostExceptions: string[];
  protocolVersion: '2026-07-28';
}

export interface AcpIntegrationConfiguration {
  displayName: string;
  transport: 'workspace-profile';
  profileId: string;
  protocolVersion: '1';
}

export type IntegrationConfiguration = McpIntegrationConfiguration | AcpIntegrationConfiguration;

export interface IntegrationView extends Scope {
  id: string;
  kind: IntegrationKind;
  configuration: IntegrationConfiguration;
  hasCredential: boolean;
  credentialRevision: number;
  schemaHash: string | null;
  enabled: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface McpToolDescriptor {
  remoteName: string;
  title: string | null;
  description: string;
  inputSchema: JsonValue;
  outputSchema: JsonValue | null;
  annotations: JsonValue | null;
}

export interface McpConnectionSnapshot {
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  tools: McpToolDescriptor[];
}

export interface McpInvocationResult {
  isError: boolean;
  content: JsonValue;
  structuredContent: JsonValue | null;
}

export interface McpRuntimePort {
  refresh(integration: IntegrationView, signal?: AbortSignal): Promise<McpConnectionSnapshot>;
  invoke(
    integration: IntegrationView,
    remoteToolName: string,
    argumentsValue: JsonValue,
    signal: AbortSignal,
  ): Promise<McpInvocationResult>;
  close(integrationId: string): Promise<void>;
  closeAll(): Promise<void>;
}

export interface IntegrationRefreshView {
  integration: IntegrationView;
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  toolCount: number;
}

export interface AcpByteTransport {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

export interface AcpTransportPort {
  open(profileId: string, signal: AbortSignal): Promise<AcpByteTransport>;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCallId: string;
  title: string | null;
  kind: string | null;
  rawInput: JsonValue | null;
}

export interface AcpExecutionRequest {
  cwd: string;
  prompt: string;
  maxOutputBytes: number;
}

export interface AcpExecutionContext {
  signal: AbortSignal;
  requestPermission(request: AcpPermissionRequest): Promise<'allow_once' | 'reject_once'>;
  onUpdate?(update: JsonValue): void;
}

export interface AcpExecutionResult {
  text: string;
  stopReason: string;
}

export interface AcpRuntimePort {
  execute(
    integration: IntegrationView,
    request: AcpExecutionRequest,
    context: AcpExecutionContext,
  ): Promise<AcpExecutionResult>;
}

export interface BrowserSessionRequest extends Scope {
  runId: string;
  agentRuntimeId: string;
  workspaceId: string;
}

export interface BrowserEndpointBinding {
  workspaceId: string;
  generation: number;
  browserWSEndpoint: string;
  allowedHosts: string[];
  close(): Promise<void>;
}

export interface BrowserEndpointPort {
  open(request: BrowserSessionRequest, signal: AbortSignal): Promise<BrowserEndpointBinding>;
}

export interface BrowserSessionView {
  sessionId: string;
  workspaceId: string;
  generation: number;
  url: string;
  createdAt: number;
}

export interface BrowserSnapshotNode {
  nodeRef: string;
  parentRef: string | null;
  tag: string;
  role: string | null;
  name: string | null;
  text: string | null;
  href: string | null;
  inputType: string | null;
  disabled: boolean;
}

export interface BrowserSnapshotView {
  sessionId: string;
  snapshotId: string;
  generation: number;
  url: string;
  title: string;
  nodes: BrowserSnapshotNode[];
  truncated: boolean;
}

export interface BrowserGatewayPort {
  createSession(request: BrowserSessionRequest, signal: AbortSignal): Promise<BrowserSessionView>;
  navigate(sessionId: string, url: string, signal: AbortSignal): Promise<BrowserSessionView>;
  snapshot(
    sessionId: string,
    options: { maxNodes?: number; maxBytes?: number },
    signal: AbortSignal,
  ): Promise<BrowserSnapshotView>;
  click(sessionId: string, snapshotId: string, nodeRef: string, signal: AbortSignal): Promise<void>;
  type(sessionId: string, snapshotId: string, nodeRef: string, text: string, signal: AbortSignal): Promise<void>;
  close(sessionId: string): Promise<void>;
  closeAll(): Promise<void>;
}
