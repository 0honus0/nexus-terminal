import type { AgentChildProfile } from '@nexus-terminal/shared/agent/collaboration/values';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';

export interface ParticipantScope {
	userId: number;
	appId: string;
	runId: string;
}

export interface Participant {
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

export type CollaborationInput =
	| {
			action: 'delegate';
			profile: AgentChildProfile;
			objective: string;
			targets: number[];
			maxRequests: number;
			durationSeconds: number;
			dependencies: string[];
			dependencyMode: 'success' | 'settled';
	  }
	| { action: 'list' }
	| { action: 'profiles' }
	| { action: 'join'; childIds: string[]; mode: 'all' | 'any'; waitSeconds: number }
	| { action: 'cancel'; childIds: string[] }
	| { action: 'send'; recipientId: string; body: string; ttlSeconds: number }
	| { action: 'read'; after: number; limit: number }
	| { action: 'consume'; through: number; expectedConsumed: number }
	| { action: 'fact_read'; key: string }
	| { action: 'fact_write'; key: string; value: string; expectedVersion: number };

export interface CollaborationFact {
	key: string;
	value: string;
	version: number;
	authorId: string;
}

export interface CollaborationMessage {
	sequence: number;
	senderId: string;
	body: string;
	expiresAt: number;
}

export interface CollaborationPage {
	messages: CollaborationMessage[];
	nextCursor: number;
	consumedThrough: number;
}

export interface DelegateCommand {
	model: import('../../providers/model/provider-types.js').ModelReference | null;
	scope: ParticipantScope;
	operationId: string;
	operationHash: string;
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
	now: number;
}

export interface CollaborationAuthority {
	scope: ParticipantScope;
	operationId: string;
	operationHash: string;
	now: number;
}

export interface ChildCreation {
	participant: Participant;
	providerId: string;
	prompt: string;
	requestHash: string;
	version: number;
	created: boolean;
}

export interface ChildAdmissionFacts {
	parent: Participant;
	selectedTargets: number[];
	children: number;
	now: number;
	dependencies: Participant[];
}

export interface CollaborationRuntime {
	admit<T>(work: (admit: () => void) => Promise<T>, maxRuns: number): Promise<T>;
	start(command: import('./run-types.js').RunExecutionCommand, parentId: string): boolean;
	abort(scope: ParticipantScope, id: string): void;
	wait(ids: string[]): Promise<void>;
	drain(scope: ParticipantScope): Promise<void>;
}

export interface MessageMetadataPage {
	items: { sequence: number; senderId: string; bodyBytes: number; expiresAt: number }[];
	nextCursor: number;
}
