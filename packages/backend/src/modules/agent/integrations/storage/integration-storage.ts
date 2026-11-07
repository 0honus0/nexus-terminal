import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

export type StoredIntegrationConfiguration =
	| {
			kind: 'mcp';
			displayName: string;
			endpoint: string;
			privateHostExceptions: string[];
			protocolVersion: '2026-07-28';
	  }
	| { kind: 'acp'; displayName: string; connectionId: number; argv: string[]; cwd: string; protocolVersion: '1' };

export interface StoredIntegrationScope {
	userId: number;
	appId: string;
}

export interface StoredIntegration {
	id: string;
	appId: string;
	configuration: StoredIntegrationConfiguration;
	enabled: boolean;
	encryptedCredential: string | null;
	credentialRevision: number;
	schemaHash: string | null;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface StoredIntegrationFacts {
	exists: boolean;
	enabled: boolean;
	identityUserId: number | null;
	count: number;
	capabilities: AgentCapability[];
}

export interface StoredIntegrationReceipt {
	id: string;
	appId: string;
	configuration: StoredIntegrationConfiguration;
	enabled: boolean;
	hasCredential: boolean;
	credentialRevision: number;
	schemaHash: string | null;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface StoredIntegrationTask {
	configuration: StoredIntegrationConfiguration;
	enabled: boolean;
	encryptedCredential: string | null;
	credentialRevision: number;
}

export type StoredIntegrationCreationDecision = { kind: 'create'; task: StoredIntegrationTask } | { kind: 'reject' };

export type StoredIntegrationCreationResult =
	{ kind: 'created'; receipt: StoredIntegrationReceipt } | { kind: 'not_created' };

export interface StoredIntegrationRejection {
	userId: number;
	appId: string;
	key: string;
	intentHash: string;
}

export interface IntegrationStorage {
	list(scope: StoredIntegrationScope): Promise<StoredIntegration[]>;
	get(scope: StoredIntegrationScope, id: string): Promise<StoredIntegration | null>;
	create(
		scope: StoredIntegrationScope,
		digest: string,
		id: string,
		key: string,
		intentHash: string,
		now: number,
		admit: (facts: StoredIntegrationFacts) => void,
		decide: (facts: StoredIntegrationFacts) => StoredIntegrationCreationDecision,
	): Promise<StoredIntegrationCreationResult>;
	prepareDiscovery(
		scope: StoredIntegrationScope,
		digest: string,
		id: string,
		version: number,
		admit: (facts: StoredIntegrationFacts) => void,
	): Promise<StoredIntegration>;
	update(
		scope: StoredIntegrationScope,
		digest: string,
		id: string,
		version: number,
		now: number,
		decide: (facts: StoredIntegrationFacts, current: StoredIntegration) => StoredIntegrationTask,
	): Promise<StoredIntegration>;
	remove(
		scope: StoredIntegrationScope,
		digest: string,
		id: string,
		version: number,
		admit: (facts: StoredIntegrationFacts) => void,
	): Promise<void>;
	discover(
		scope: StoredIntegrationScope,
		digest: string,
		id: string,
		version: number,
		hash: string,
		admit: (facts: StoredIntegrationFacts) => void,
	): Promise<StoredIntegration>;
}

export class IntegrationStorageRefusal extends Error {
	constructor(readonly code: 'not_found' | 'version_conflict' | 'idempotency_conflict') {
		super(code);
	}
}
