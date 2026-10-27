import type { AgentPluginRpcInput, AgentPluginRpcResult } from './events.js';
import type { AgentErrorResponse } from '../http.js';

export interface AgentPluginBackendContext {
	protocol: 1;
	sdkVersion: '1';
	appId: string;
	definitionId: string;
	version: string;
	revision: number;
}

export type AgentPluginBackendReply =
	| {
			ok: true;
			result: AgentPluginRpcResult;
	  }
	| { ok: false; error: AgentErrorResponse };

export interface AgentPluginBackendActivation {
	context: Readonly<AgentPluginBackendContext>;
	request(input: AgentPluginRpcInput): Promise<AgentPluginBackendReply>;
}

export interface AgentPluginBackendModule {
	activate?(input: AgentPluginBackendActivation): Promise<void> | void;
	health?(): Promise<boolean> | boolean;
	quiesce?(deadlineUnixMs: number): Promise<void> | void;
	dispose?(): Promise<void> | void;
}
