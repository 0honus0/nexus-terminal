import type { AgentPluginUiInput, AgentPluginUiResult } from './ui-http.js';
import type { AgentPluginRpcInput, AgentPluginRpcResult } from './events.js';
import type { AgentHttpErrorCode } from '../values.js';
import type { AgentWorkspaceInput, AgentWorkspaceResult } from '../scope/workspace-http.js';

export type AgentPluginFrontendInput = AgentPluginRpcInput | AgentWorkspaceInput | AgentPluginUiInput;

export type AgentPluginFrontendResult = AgentPluginRpcResult | AgentWorkspaceResult | AgentPluginUiResult;

export interface AgentPluginRpcEnvelope {
	type: 'nexus.plugin.request';
	protocol: 4;
	nonce: string;
	id: string;
	seq: number;
	request: AgentPluginFrontendInput;
}

export type AgentPluginRpcResponse = {
	type: 'nexus.plugin.response';
	protocol: 4;
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
	protocol: 4;
	nonce: string;
	appId: string;
	/** Original frontend grant expiry, in Unix milliseconds. */
	expiresAt: number;
}

export interface AgentPluginReady {
	type: 'nexus.plugin.ready';
	protocol: 4;
}

export interface AgentPluginAck {
	type: 'nexus.plugin.ack';
	protocol: 4;
	nonce: string;
	seq: 0;
}

export type AgentPluginStreamCommand = {
	type: 'nexus.plugin.stream';
	protocol: 4;
	nonce: string;
	seq: number;
	subscriptionId: string;
	generation: number;
} & (
	| { command: 'subscribe'; source: { kind: 'run-events'; runId: string; after: number } }
	| { command: 'ack'; revision: number }
	| { command: 'unsubscribe' }
);

export type AgentPluginStreamEvent = {
	type: 'nexus.plugin.stream-event';
	protocol: 4;
	nonce: string;
	subscriptionId: string;
	generation: number;
} & (
	| { ok: true; revision: number; value: import('../runs/http.js').AgentRunEventsResponse }
	| { ok: false; error: { code: AgentHttpErrorCode } }
);

export type AgentPluginControl = {
	protocol: 4;
	nonce: string;
	seq: number;
} & ({ type: 'nexus.plugin.cancel'; id: string } | { type: 'nexus.plugin.close' });

/** A trusted parent interaction was dismissed before command dispatch. This is not an HTTP authority failure. */
export interface AgentPluginCancelled {
	type: 'nexus.plugin.cancelled';
	protocol: 4;
	nonce: string;
	id: string;
	seq: number;
}
