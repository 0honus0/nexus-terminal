import type { ToolJobControlInput } from './tool-types.js';
import type { ToolWriteItem, ToolMoveItem, ToolDeleteItem, ToolDockerControlItem } from './tool-batch-types.js';

export type HostToolCommand =
	| { kind: 'discovery_catalog'; cursor: number; sha256: string | null }
	| { kind: 'discovery_activate'; names: string[] }
	| { kind: 'browser_targets' }
	| { kind: 'image_models' }
	| { kind: 'image_generate'; input: import('../../providers/model/provider-types.js').ProviderImageRequest }
	| { kind: 'skill'; input: import('../../plugins/model/plugin-skill-types.js').PluginSkillInput }
	| { kind: 'browser'; input: import('../../integrations/model/browser-types.js').BrowserInput }
	| { kind: 'host_diagnostics' }
	| { kind: 'artifact'; action: 'create'; name: string; mediaType: string; base64: string }
	| { kind: 'artifact'; action: 'present'; artifactId: string }
	| { kind: 'artifact'; action: 'capacity'; sizeBytes: number }
	| {
			kind: 'artifact';
			action: 'read';
			artifactId: string;
			offset: number;
			maxBytes: number;
			encoding: 'base64' | 'utf8';
	  }
	| { kind: 'memory'; action: 'propose'; content: string; confidence: number; expiresAt: number | null }
	| { kind: 'memory'; action: 'candidates'; limit: number; offset: number }
	| {
			kind: 'memory';
			action: 'select';
			limit: number;
			candidatesSha256: string;
			items: { id: string; version: number; score: number }[];
	  }
	| { kind: 'result'; item: import('../../context/model/context-types.js').ResultReadInput }
	| { kind: 'project'; connectionId: number; input: import('./tool-project-types.js').ProjectInput }
	| { kind: 'collaboration'; input: import('../../runs/model/run-collaboration-types.js').CollaborationInput }
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
	| { kind: 'docker_inspect'; connectionId: number; containerId: string }
	| { kind: 'docker_control'; connectionId: number; items: ToolDockerControlItem[]; onError: 'stop' | 'continue' }
	| { kind: 'connections' }
	| { kind: 'diagnostics'; connectionId: number }
	| { kind: 'deliver'; connectionId: number; paths: string[] }
	| { kind: 'inspect'; connectionId: number; path: string }
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
