import type { AgentPluginRpcInput, AgentPluginRpcResult } from './events.js';
import type { AgentHttpErrorCode } from '../values.js';
import type { AgentWorkspaceInput, AgentWorkspaceResult } from '../scope/workspace-http.js';

export type AgentPluginFrontendInput = AgentPluginRpcInput | AgentWorkspaceInput;

export type AgentPluginFrontendResult = AgentPluginRpcResult | AgentWorkspaceResult;

export interface AgentPluginRpcEnvelope {
	type: 'nexus.plugin.request';
	protocol: 1;
	nonce: string;
	id: string;
	seq: number;
	request: AgentPluginFrontendInput;
}

export type AgentPluginRpcResponse = {
	type: 'nexus.plugin.response';
	protocol: 1;
	nonce: string;
	id: string;
	seq: number;
} & ({ ok: true; result: AgentPluginFrontendResult } | { ok: false; error: { code: AgentHttpErrorCode } });

export interface AgentPluginFrontendRpcRequest {
	grant: string;
	envelope: AgentPluginRpcEnvelope;
}

export interface AgentPluginInit {
	type: 'nexus.plugin.init';
	protocol: 1;
	nonce: string;
	appId: string;
}

export interface AgentPluginReady {
	type: 'nexus.plugin.ready';
	protocol: 1;
}

export interface AgentPluginAck {
	type: 'nexus.plugin.ack';
	protocol: 1;
	nonce: string;
	seq: 0;
}
