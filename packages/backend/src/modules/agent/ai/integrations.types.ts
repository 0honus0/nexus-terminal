import type { JsonValue, Scope } from '../agent.types';
import type { AgentBrowserEndpointSetting } from '../agent-defaults';

export type IntegrationKind = 'mcp' | 'acp';

export interface McpIntegrationConfiguration {
  displayName: string;
  transport: 'streamable-http';
  endpoint: string;
  privateHostExceptions: string[];
  protocolVersion: '2026-07-28';
  trustToolAnnotations?: boolean;
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

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  title: string | null;
  description: string;
  mimeType: string | null;
  annotations: JsonValue | null;
}

export interface McpPromptDescriptor {
  name: string;
  title: string | null;
  description: string;
  arguments: Array<{ name: string; description: string | null; required: boolean }>;
}

export interface McpConnectionSnapshot {
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  tools: McpToolDescriptor[];
  resources: McpResourceDescriptor[];
  prompts: McpPromptDescriptor[];
}

export interface McpInputRequiredResult {
  kind: 'input_required';
  inputRequests: JsonValue;
  requestState: string | null;
}

export interface McpInvocationCompleteResult {
  kind: 'complete';
  isError: boolean;
  content: JsonValue;
  structuredContent: JsonValue | null;
}

export type McpInvocationResult = McpInvocationCompleteResult | McpInputRequiredResult;

export interface McpResourceReadCompleteResult {
  kind: 'complete';
  contents: JsonValue;
}

export type McpResourceReadResult = McpResourceReadCompleteResult | McpInputRequiredResult;

export interface McpPromptGetCompleteResult {
  kind: 'complete';
  description: string | null;
  messages: JsonValue;
}

export type McpPromptGetResult = McpPromptGetCompleteResult | McpInputRequiredResult;

export interface McpInputResume {
  requestState?: string;
  inputResponses: JsonValue;
}

export interface McpRuntimePort {
  refresh(integration: IntegrationView, signal?: AbortSignal): Promise<McpConnectionSnapshot>;
  invoke(
    integration: IntegrationView,
    remoteToolName: string,
    argumentsValue: JsonValue,
    signal: AbortSignal,
    resume?: McpInputResume,
  ): Promise<McpInvocationResult>;
  readResource(
    integration: IntegrationView,
    uri: string,
    signal: AbortSignal,
    resume?: McpInputResume,
  ): Promise<McpResourceReadResult>;
  getPrompt(
    integration: IntegrationView,
    name: string,
    argumentsValue: JsonValue,
    signal: AbortSignal,
    resume?: McpInputResume,
  ): Promise<McpPromptGetResult>;
  close(integrationId: string): Promise<void>;
  closeAll(): Promise<void>;
}

export interface IntegrationRefreshView {
  integration: IntegrationView;
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
}

export interface AcpByteTransport {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

export interface AcpTransportOpenRequest {
  workspaceId: string;
  generation: number;
  profileId: string;
}

export interface AcpTransportPort {
  open(request: AcpTransportOpenRequest, signal: AbortSignal): Promise<AcpByteTransport>;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCallId: string;
  title: string | null;
  kind: string | null;
  rawInput: JsonValue | null;
}

export interface AcpExecutionRequest {
  workspaceId: string;
  generation: number;
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

export type BrowserEndpointSetting = AgentBrowserEndpointSetting;

export interface BrowserTargetSnapshot {
  id: string;
  profileRevision: number;
  configurationHash: string;
  endpoints: BrowserEndpointSetting[];
  allowedUrlPatterns: string[];
}

export interface BrowserSessionRequest extends Scope {
  runId: string;
  agentRuntimeId: string;
  target: BrowserTargetSnapshot;
  workspaceId?: string;
  generation?: number;
}

export interface BrowserSessionView extends Scope {
  sessionId: string;
  runId: string;
  agentRuntimeId: string;
  targetId: string;
  targetRevision: number;
  targetConfigurationHash: string;
  workspaceId: string | null;
  generation: number | null;
  url: string;
  createdAt: number;
}

export interface BrowserMessageTransport {
  send(message: string): void;
  onMessage(listener: (message: string) => void): () => void;
  onClose(listener: () => void): () => void;
  close(): Promise<void>;
}

export interface BrowserTunnelPort {
  openBrowserTunnel(
    endpoint: BrowserEndpointSetting,
    binding: { targetId: string; targetRevision: number; workspaceId?: string; generation?: number },
    signal: AbortSignal,
  ): Promise<BrowserMessageTransport>;
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
  generation: number | null;
  targetId: string;
  url: string;
  title: string;
  nodes: BrowserSnapshotNode[];
  truncated: boolean;
}

export interface BrowserScreenshotView {
  sessionId: string;
  generation: number | null;
  targetId: string;
  url: string;
  title: string;
  mediaType: 'image/png';
  width: number;
  height: number;
  bytes: Uint8Array;
}

export interface BrowserPostActionView {
  sessionId: string;
  generation: number | null;
  targetId: string;
  url: string;
  title: string;
  navigationChanged: boolean;
}

export interface BrowserConsoleEntry {
  sequence: number;
  type: 'log' | 'debug' | 'info' | 'error' | 'warning' | 'other';
  text: string;
  url: string | null;
  line: number | null;
  column: number | null;
}

export interface BrowserConsoleView {
  sessionId: string;
  entries: BrowserConsoleEntry[];
  nextCursor: number;
  truncated: boolean;
}

export interface BrowserUploadFile {
  name: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface BrowserDownloadView {
  sessionId: string;
  generation: number | null;
  targetId: string;
  url: string;
  name: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface BrowserGatewayPort {
  createSession(request: BrowserSessionRequest, signal: AbortSignal): Promise<BrowserSessionView>;
  getSession(sessionId: string, signal?: AbortSignal): Promise<BrowserSessionView>;
  navigate(
    sessionId: string,
    url: string,
    options: { settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView>;
  snapshot(
    sessionId: string,
    options: { maxNodes?: number; maxBytes?: number },
    signal: AbortSignal,
  ): Promise<BrowserSnapshotView>;
  screenshot(sessionId: string, options: { maxBytes?: number }, signal: AbortSignal): Promise<BrowserScreenshotView>;
  click(
    sessionId: string,
    snapshotId: string,
    nodeRef: string,
    options: { settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView>;
  type(
    sessionId: string,
    snapshotId: string,
    nodeRef: string,
    text: string,
    options: { settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView>;
  scroll(
    sessionId: string,
    options: { deltaX: number; deltaY: number; settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView>;
  press(
    sessionId: string,
    options: {
      key: string;
      modifiers?: string[];
      snapshotId?: string;
      nodeRef?: string;
      settleMs?: number;
    },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView>;
  back(sessionId: string, options: { settleMs?: number }, signal: AbortSignal): Promise<BrowserPostActionView>;
  select(
    sessionId: string,
    snapshotId: string,
    nodeRef: string,
    values: string[],
    options: { settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView>;
  wait(
    sessionId: string,
    options: { mode: 'timeout' | 'networkIdle'; maxMillis: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView>;
  console(
    sessionId: string,
    options: { afterCursor?: number; limit?: number; maxBytes?: number },
    signal: AbortSignal,
  ): Promise<BrowserConsoleView>;
  upload(
    sessionId: string,
    snapshotId: string,
    nodeRef: string,
    file: BrowserUploadFile,
    options: { settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView>;
  download(
    sessionId: string,
    snapshotId: string,
    nodeRef: string,
    options: { maxBytes?: number },
    signal: AbortSignal,
  ): Promise<BrowserDownloadView>;
  close(sessionId: string): Promise<void>;
  closeWorkspace(workspaceId: string, generation?: number): void;
  closeAll(): Promise<void>;
}
