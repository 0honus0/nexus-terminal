import type { AgentHttpErrorCode } from '@nexus-terminal/shared/agent/values';
import type { StoredPluginIntent } from './plugin-intent-storage.js';
import type { StoredArtifact } from '../../artifacts/storage/artifact-storage.js';
import type { StoredPluginData, StoredPluginInstallation } from './plugin-storage.js';

export type PluginRuntimeRequest =
	| { method: 'host.appInfo' }
	| { method: 'storage.get'; key: string }
	| { method: 'storage.put'; key: string; expectedVersion: number; operationId: string; valueJson: string }
	| { method: 'storage.delete'; key: string; expectedVersion: number; operationId: string }
	| {
			method: 'intents.create';
			input: {
				operationId: string;
				receiverAppId: string;
				intentId: string;
				inputJson: string;
				artifactIds: string[];
				confirmed: true;
			};
	  }
	| { method: 'intents.listReceived'; limit: number }
	| { method: 'intents.revoke'; receiptId: string }
	| { method: 'intents.artifacts.get'; receiptId: string; artifactId: string }
	| {
			method: 'intents.artifacts.readRange';
			receiptId: string;
			artifactId: string;
			start: number;
			endInclusive: number;
	  };

export type PluginRuntimeReply =
	| { ok: false; code: AgentHttpErrorCode }
	| { ok: true; method: 'host.appInfo'; value: StoredPluginInstallation }
	| { ok: true; method: 'storage.get'; value: StoredPluginData | null }
	| { ok: true; method: 'storage.put' | 'storage.delete'; value: StoredPluginData }
	| { ok: true; method: 'intents.create'; value: StoredPluginIntent }
	| { ok: true; method: 'intents.listReceived'; value: StoredPluginIntent[] }
	| { ok: true; method: 'intents.revoke'; value: { revoked: true } }
	| { ok: true; method: 'intents.artifacts.get'; value: StoredArtifact }
	| {
			ok: true;
			method: 'intents.artifacts.readRange';
			value: { receiptId: string; artifactId: string; start: number; endInclusive: number; bytes: Uint8Array };
	  };

export interface PluginBackendInstance {
	readonly exited: Promise<void>;

	activate(): Promise<void>;
	health(): Promise<boolean>;
	quiesce(deadline: number): Promise<void>;
	close(): Promise<void>;
}

export interface PluginBackendRuntime {
	recover(): Promise<void>;
	open(input: {
		appId: string;
		definitionId: string;
		version: string;
		revision: number;
		entry: string;
		files: { path: string; bytes: Uint8Array; sha256: string }[];
		host(request: PluginRuntimeRequest): Promise<PluginRuntimeReply>;
	}): Promise<PluginBackendInstance>;
}
