import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { StoredArtifact } from '../../artifacts/storage/artifact-storage.js';

export interface StoredPluginIntentApp {
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

export interface StoredPluginIntent {
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

export interface StoredPluginIntentCommand {
	id: string;
	receiverAppId: string;
	intentId: string;
	inputJson: string;
	artifactIds: string[];
}

export interface StoredPluginIntentFacts {
	identityUserId: number | null;
	sender: StoredPluginIntentApp | null;
	receiver: StoredPluginIntentApp | null;
	artifacts: StoredArtifact[];
	count: number;
	evidenceCount: number;
	evidenceBytes: number;
	now: number;
}

export class PluginIntentStorageRefusal extends Error {
	constructor(readonly code: 'not_found' | 'version_conflict') {
		super(code);
	}
}

export type PluginIntentIdentity = { kind: 'session'; digest: string } | { kind: 'runtime' };

export interface PluginIntentStorage {
	create(
		userId: number,
		identity: PluginIntentIdentity,
		appId: string,
		input: StoredPluginIntentCommand,
		admit: (facts: StoredPluginIntentFacts, replay: StoredPluginIntent | null) => void,
		decide: (facts: StoredPluginIntentFacts) => StoredPluginIntent,
	): Promise<StoredPluginIntent>;
	list(
		userId: number,
		identity: PluginIntentIdentity,
		appId: string,
		limit: number,
		admit: (identity: number | null, app: StoredPluginIntentApp | null) => void,
		visible: (
			value: StoredPluginIntent,
			sender: StoredPluginIntentApp | null,
			receiver: StoredPluginIntentApp | null,
			now: number,
		) => boolean,
	): Promise<StoredPluginIntent[]>;
	revoke(
		userId: number,
		identity: PluginIntentIdentity,
		appId: string,
		id: string,
		admit: (identity: number | null, app: StoredPluginIntentApp | null) => void,
	): Promise<void>;
	getArtifact(
		userId: number,
		identity: PluginIntentIdentity,
		appId: string,
		id: string,
		artifactId: string,
		admit: (
			identity: number | null,
			receipt: StoredPluginIntent,
			sender: StoredPluginIntentApp | null,
			receiver: StoredPluginIntentApp | null,
			now: number,
		) => void,
	): Promise<StoredArtifact>;
}
