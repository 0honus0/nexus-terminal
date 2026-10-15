import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { ArtifactRecord } from '../../artifacts/model/artifact-types.js';

export interface PluginIntentSessionActor {
	userId: number;
	appId: string;
	token: string;
	authorization: { kind: 'session' } | { kind: 'frontend'; revision: number; expiresAt: number };
}

export type PluginIntentActor =
	| PluginIntentSessionActor
	| {
			userId: number;
			appId: string;
			authorization: { kind: 'runtime'; revision: number; validate(): void };
	  };

export interface PluginIntentApp {
	id: string;
	version: string;
	revision: string;
	pluginRevision: number | null;
	enabled: boolean;
	declared: boolean;
	capabilities: AgentCapability[];
	grants: AgentCapability[];
	intents: { id: string; schemaVersion: number }[];
}

export interface PluginIntentReceipt {
	id: string;
	senderAppId: string;
	receiverAppId: string;
	senderVersion: string;
	receiverVersion: string;
	senderRevision: string;
	receiverRevision: string;
	intentId: string;
	schemaVersion: number;
	inputJson: string;
	artifactIds: string[];
	createdAt: number;
	expiresAt: number;
	revokedAt: number | null;
}

export interface PluginIntentCreate {
	operationId: string;
	receiverAppId: string;
	intentId: string;
	inputJson: string;
	artifactIds: string[];
	confirmed: true;
}

export interface PluginIntentFacts {
	identityUserId: number | null;
	sender: PluginIntentApp | null;
	receiver: PluginIntentApp | null;
	artifacts: ArtifactRecord[];
	count: number;
	evidenceCount: number;
	evidenceBytes: number;
	now: number;
}

export type PluginIntentRpcInput =
	| { method: 'intents.create'; input: PluginIntentCreate }
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

export type PluginIntentRpcResult =
	| { method: 'intents.create'; value: PluginIntentReceipt }
	| { method: 'intents.listReceived'; value: PluginIntentReceipt[] }
	| { method: 'intents.revoke'; value: { revoked: true } }
	| { method: 'intents.artifacts.get'; value: ArtifactRecord }
	| {
			method: 'intents.artifacts.readRange';
			value: { receiptId: string; artifactId: string; start: number; endInclusive: number; bytes: Uint8Array };
	  };
