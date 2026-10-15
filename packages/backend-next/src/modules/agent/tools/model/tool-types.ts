import type { AgentCapability, AgentApprovalRisk } from '@nexus-terminal/shared/agent/governance/values';

/** Server-owned definition. Model proposals never supply capability, version or risk. */
export interface ToolDefinition {
	name: string;
	version: string;
	description: string;
	capability: AgentCapability;
	risk: AgentApprovalRisk;
	mutation: boolean;
	input: { fields: ToolInputField[] };
}

export type ToolInputField = { name: string; required: boolean } & (
	| { kind: 'integer'; minimum: number; maximum: number }
	| { kind: 'texts'; maxItems: number; maxItemBytes: number }
	| { kind: 'text'; maxBytes: number; allowEmpty: boolean }
);

export type ToolInput =
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
	| { kind: 'artifact'; action: 'read'; artifactId: string; offset: number; maxBytes: number }
	| { kind: 'memory'; action: 'propose'; content: string }
	| { kind: 'memory'; action: 'recall'; query: string; limit: number }
	| { kind: 'result'; input: import('../../context/model/context-types.js').ResultReadInput }
	| { kind: 'project'; connectionId: number; input: import('./tool-project-types.js').ProjectInput }
	| { kind: 'collaboration'; input: import('../../runs/model/run-collaboration-types.js').CollaborationInput }
	| { kind: 'acp'; connectionId: number; argv: string[]; cwd: string; prompt: string }
	| {
			kind: 'shell';
			connectionId: number;
			command: ToolCommand;
			cwd: string | null;
			mode: 'foreground' | 'background';
	  }
	| ({ kind: 'job'; connectionId: number } & ToolJobControlInput)
	| { kind: 'docker_inspect'; connectionId: number; containerId: string }
	| {
			kind: 'docker_control';
			connectionId: number;
			containerId: string;
			action: import('@nexus-terminal/shared/remote/docker/values').DockerAction;
			expectedFingerprint: string;
	  }
	| { kind: 'connections' }
	| { kind: 'diagnostics'; connectionId: number }
	| { kind: 'read'; connectionId: number; path: string }
	| { kind: 'list'; connectionId: number; path: string }
	| { kind: 'inspect'; connectionId: number; path: string }
	| { kind: 'patch'; connectionId: number; path: string; expectedSha256: string; oldText: string; newText: string }
	| { kind: 'move'; connectionId: number; path: string; destinationPath: string; expectedFingerprint: string }
	| { kind: 'delete'; connectionId: number; path: string; expectedFingerprint: string; scope: 'entry' | 'tree' }
	| { kind: 'write'; connectionId: number; path: string; content: string; expectedSha256: string }
	| { kind: 'search'; connectionId: number; path: string; query: string; maxResults: number };

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

export type ToolCommand = { kind: 'argv'; argv: string[] } | { kind: 'shell'; script: string };

export interface ToolJobControlInput {
	action: 'list' | 'status' | 'wait' | 'cancel';
	jobId: string | null;
	waitSeconds: number;
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
