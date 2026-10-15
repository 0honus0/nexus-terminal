import type { AgentPluginData, AgentPluginInstallation } from './model.js';
import type { AgentPluginIntentCreateRequest } from './intent-http.js';
import type { AgentPluginIntentReceipt } from './intent-model.js';
import type { AgentArtifactView } from '../artifacts/model.js';

export type AgentPluginRpcInput =
	| { method: 'host.appInfo'; params: Record<string, never> }
	| { method: 'storage.get'; params: { key: string } }
	| {
			method: 'storage.put';
			params: { key: string; expectedVersion: number; operationId: string; valueJson: string };
	  }
	| { method: 'storage.delete'; params: { key: string; expectedVersion: number; operationId: string } }
	| { method: 'intents.create'; params: AgentPluginIntentCreateRequest }
	| { method: 'intents.listReceived'; params: { limit: number } }
	| { method: 'intents.revoke'; params: { receiptId: string } }
	| { method: 'intents.artifacts.get'; params: { receiptId: string; artifactId: string } }
	| {
			method: 'intents.artifacts.readRange';
			params: { receiptId: string; artifactId: string; start: number; endInclusive: number };
	  };

export type AgentPluginRpcResult =
	| { method: 'host.appInfo'; value: AgentPluginInstallation }
	| { method: 'storage.get'; value: AgentPluginData | null }
	| { method: 'storage.put' | 'storage.delete'; value: AgentPluginData }
	| { method: 'intents.create'; value: AgentPluginIntentReceipt }
	| { method: 'intents.listReceived'; value: AgentPluginIntentReceipt[] }
	| { method: 'intents.revoke'; value: { revoked: true } }
	| { method: 'intents.artifacts.get'; value: AgentArtifactView }
	| {
			method: 'intents.artifacts.readRange';
			value: { receiptId: string; artifactId: string; start: number; endInclusive: number; dataBase64: string };
	  };
