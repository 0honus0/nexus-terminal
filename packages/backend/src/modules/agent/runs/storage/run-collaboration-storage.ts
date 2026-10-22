import type { AgentChildProfile } from '@nexus-terminal/shared/agent/collaboration/values';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';

export interface StoredParticipantScope {
	userId: number;
	appId: string;
	runId: string;
}

export interface StoredParticipant {
	version: number;
	id: string;
	rootId: string;
	parentId: string | null;
	status: AgentRunStatus;
	profile: 'root' | AgentChildProfile;
	output: string | null;
	tools: string[];
	maxRequests: number;
	deadline: number;
	dependencies: string[];
	dependencyMode: 'success' | 'settled';
}

export interface StoredCollaborationAuthority {
	scope: StoredParticipantScope;
	operationId: string;
	operationHash: string;
	now: number;
}

export interface StoredDelegateCommand extends StoredCollaborationAuthority {
	id: string;
	requestHash: string;
	objective: string;
	targets: number[];
	profile: AgentChildProfile;
	tools: string[];
	maxRequests: number;
	deadline: number;
	dependencies: string[];
	dependencyMode: 'success' | 'settled';
}

export interface StoredChildCreation {
	participant: StoredParticipant;
	providerId: string;
	prompt: string;
	requestHash: string;
	version: number;
	created: boolean;
}

export interface StoredChildAdmissionFacts {
	parent: StoredParticipant;
	selectedTargets: number[];
	children: number;
	now: number;
	dependencies: StoredParticipant[];
}

export interface StoredCollaborationFact {
	key: string;
	value: string;
	version: number;
	authorId: string;
}

export interface StoredCollaborationMessage {
	sequence: number;
	senderId: string;
	body: string;
	expiresAt: number;
}

export interface StoredCollaborationPage {
	messages: StoredCollaborationMessage[];
	nextCursor: number;
	consumedThrough: number;
}

export interface RunCollaborationStorage {
	messageMetadata(scope: StoredParticipantScope, after: number, limit: number): Promise<StoredMessageMetadataPage>;
	participant(scope: StoredParticipantScope): Promise<StoredParticipant | null>;
	children(scope: StoredParticipantScope): Promise<StoredParticipant[]>;
	delegate(
		command: StoredDelegateCommand,
		admit: (facts: StoredChildAdmissionFacts) => boolean,
	): Promise<StoredChildCreation | null>;
	cancelChildren(
		scope: StoredParticipantScope,
		ids: string[] | null,
		now: number,
		authority: StoredCollaborationAuthority | null,
	): Promise<string[]>;
	fact(authority: StoredCollaborationAuthority, key: string): Promise<StoredCollaborationFact | null>;
	writeFact(
		authority: StoredCollaborationAuthority,
		key: string,
		value: string,
		expectedVersion: number,
		maxFacts: number,
	): Promise<StoredCollaborationFact | 'version_conflict' | 'limit_exceeded'>;
	send(
		authority: StoredCollaborationAuthority,
		id: string,
		recipientId: string,
		body: string,
		expiresAt: number,
		maxMessages: number,
		maxBytes: number,
	): Promise<number>;
	read(authority: StoredCollaborationAuthority, after: number, limit: number): Promise<StoredCollaborationPage>;
	consume(
		authority: StoredCollaborationAuthority,
		through: number,
		expectedConsumed: number,
	): Promise<number | 'version_conflict'>;
}

export class CollaborationStorageRefusal extends Error {
	constructor(readonly code: 'version_conflict' | 'limit_exceeded' | 'invalid_input') {
		super('Collaboration storage: ' + code);
		this.name = 'CollaborationStorageRefusal';
	}
}

export interface StoredMessageMetadataPage {
	items: { sequence: number; senderId: string; bodyBytes: number; expiresAt: number }[];
	nextCursor: number;
}
