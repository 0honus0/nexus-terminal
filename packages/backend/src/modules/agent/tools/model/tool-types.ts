import type { AgentCapability, AgentApprovalRisk } from '@nexus-terminal/shared/agent/governance/values';
import type { ToolWriteItem, ToolMoveItem, ToolDeleteItem, ToolDockerControlItem } from './tool-batch-types.js';
import type { PluginAgentCatalog } from '../../plugins/model/plugin-contribution-types.js';

export interface ToolStepContext {
	definitions: ToolDefinition[];
	availableDefinitions: ToolDefinition[];
	systemPrompt: string;
	pluginCatalog: PluginAgentCatalog;
}

/** Server-owned definition. Model proposals never supply capability, version or risk. */
export interface ToolDefinition {
	name: string;
	version: string;
	description: string;
	capability: AgentCapability;
	risk: AgentApprovalRisk;
	mutation: boolean;
	scheduling: 'parallel' | 'exclusive';
	input: { fields: ToolInputField[] };
}

export type ToolInputField = { name: string; required: boolean } & (
	| { kind: 'integer'; minimum: number; maximum: number }
	| { kind: 'texts'; maxItems: number; maxItemBytes: number }
	| { kind: 'objects'; maxItems: number; fields: ToolInputField[] }
	| { kind: 'text'; maxBytes: number; allowEmpty: boolean; choices?: readonly string[] }
);

export type ToolInput =
	| { kind: 'tool_search'; query: string }
	| { kind: 'plugin'; name: string; version: string; sha256: string; argumentsJson: string }
	| { kind: 'browser_targets' }
	| { kind: 'acp_integrations' }
	| { kind: 'image_models'; offset: number }
	| { kind: 'image_generate'; input: import('../../providers/model/provider-types.js').ProviderImageRequest }
	| { kind: 'skill'; input: import('../../plugins/model/plugin-skill-types.js').PluginSkillInput }
	| { kind: 'mcp_discovery'; input: import('../../integrations/model/integration-types.js').IntegrationCatalogInput }
	| { kind: 'browser'; input: import('../../integrations/model/browser-types.js').BrowserInput }
	| {
			kind: 'acp_integration';
			input: import('../../integrations/model/integration-types.js').AcpIntegrationInvocation;
	  }
	| { kind: 'mcp'; input: import('../../integrations/model/integration-types.js').IntegrationInvocation }
	| { kind: 'host_diagnostics' }
	| { kind: 'checkpoint'; summary: string }
	| { kind: 'artifact'; action: 'create'; name: string; content: string }
	| { kind: 'artifact'; action: 'present'; artifactIds: string[] }
	| {
			kind: 'artifact';
			action: 'read';
			artifactId: string;
			offset: number;
			maxBytes: number;
			encoding: 'base64' | 'utf8';
	  }
	| { kind: 'memory'; action: 'propose'; content: string }
	| { kind: 'memory'; action: 'recall'; query: string; limit: number }
	| { kind: 'result'; items: import('../../context/model/context-types.js').ResultReadInput[] }
	| { kind: 'project'; connectionId: number; input: import('./tool-project-types.js').ProjectInput }
	| { kind: 'collaboration'; input: import('../../runs/model/run-collaboration-types.js').CollaborationInput }
	| { kind: 'acp'; connectionId: number; argv: string[]; cwd: string; prompt: string }
	| {
			kind: 'shell';
			connectionId: number;
			commands: string[];
			onError: 'stop' | 'continue';
			cwd: string | null;
			mode: 'foreground' | 'background';
			yieldSeconds: number | null;
	  }
	| ({ kind: 'job'; connectionId: number } & ToolJobControlInput)
	| { kind: 'docker_inspect'; connectionId: number; containerIds: string[] }
	| { kind: 'docker_control'; connectionId: number; items: ToolDockerControlItem[]; onError: 'stop' | 'continue' }
	| { kind: 'connections' }
	| { kind: 'diagnostics'; connectionId: number }
	| { kind: 'deliver'; connectionId: number; paths: string[] }
	| { kind: 'read'; connectionId: number; paths: string[]; offset: number; maxBytes: number }
	| { kind: 'list'; connectionId: number; paths: string[]; after: string }
	| { kind: 'inspect'; connectionId: number; paths: string[] }
	| {
			kind: 'patch';
			connectionId: number;
			path: string;
			expectedSha256: string;
			edits: Array<{ oldText: string; newText: string }>;
	  }
	| { kind: 'move'; connectionId: number; items: ToolMoveItem[]; onError: 'stop' | 'continue' }
	| { kind: 'delete'; connectionId: number; items: ToolDeleteItem[]; onError: 'stop' | 'continue' }
	| { kind: 'write'; connectionId: number; items: ToolWriteItem[]; onError: 'stop' | 'continue' }
	| { kind: 'search'; connectionId: number; path: string; queries: string[]; maxResults: number };

export interface ToolConnection {
	id: number;
	version: number;
	type: import('@nexus-terminal/shared/targets/connections/values').ConnectionType;
	name: string;
	host: string;
	port: number;
	username: string;
}

export interface ToolTarget {
	id: number;
	version: number;
	fingerprint: string;
}

export interface ToolOperationScope {
	operationId: string;
	timeoutMs: number;
	target: ToolTarget;
	signal: AbortSignal;
	validate(): Promise<void>;
	permission?: (input: ToolAcpPermission, signal: AbortSignal) => Promise<ToolAcpPermissionResponse>;
}

export interface ToolExecutionScope {
	pluginCatalog: PluginAgentCatalog;
	availableDefinitions: ToolDefinition[];
	onToolsLoaded(names: string[]): void;
	userId: number;
	appId: string;
	runId: string;
	modelStepIndex: number;
	deadlineAt: number;
	onBackgroundFailure(error: unknown, toolName?: string): void;
}

export interface ToolJobControlInput {
	action: 'list' | 'status' | 'wait' | 'cancel' | 'output';
	jobIds: string[];
	waitMode: 'all' | 'any';
	waitSeconds: number;
	offset: number;
}

export interface ToolAcpPermission {
	sessionId: string;
	toolCallId: string;
	requestId: string;
	title: string | null;
	kind: string | null;
	inputJson: string;
}

export interface ToolAcpPermissionResponse {
	decision: 'allow_once' | 'reject_once';
	delivered(): Promise<void>;
}

export interface ToolFileContent {
	name: string;
	sizeBytes: number;
}
