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
	/** Bounded preview; complete immutable output is read separately. */
	output: string | null;
	outputBytes: number;
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
			inputJson: string;
			targets: number[];

			dependencies: string[];
			dependencyMode: 'success' | 'settled';
	  }
	| { action: 'list'; after: string | null; limit: number }
	| { action: 'output_read'; childId: string; offset: number; maxBytes: number }
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
	scope: ParticipantScope;
	operationId: string;
	operationHash: string;
	id: string;
	requestHash: string;
	objective: string;
	inputJson: string;
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
	inputJson: string;
	prompt: string;
	requestHash: string;
	version: number;
	created: boolean;
}

export interface ChildAdmissionFacts {
	parent: Participant;
	selectedTargets: number[];
	activeChildIds: string[];
	now: number;
	dependencies: Participant[];
}

export interface CollaborationRuntime {
	occupiedChildIds(scope: ParticipantScope): string[];
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

export interface CollaborationWatch {
	changed: Promise<void>;
	close(): void;
}

export interface CollaborationChildView {
	id: string;
	parentId: string | null;
	status: AgentRunStatus;
	profile: AgentChildProfile;
	output: string | null;
	outputBytes: number;
	outputTruncated: boolean;
	maxRequests: number;
	deadline: number;
}

export type CollaborationResult =
	| { operation: 'collaboration.delegate'; value: CollaborationChildView }
	| { operation: 'collaboration.list'; value: { children: CollaborationChildView[]; nextCursor: string | null } }
	| { operation: 'collaboration.join'; value: { children: CollaborationChildView[]; ready: boolean } }
	| { operation: 'collaboration.cancel'; value: { children: CollaborationChildView[] } }
	| {
			operation: 'collaboration.readOutput';
			value: {
				childId: string;
				sha256: string;
				originalBytes: number;
				offset: number;
				nextOffset: number | null;
				text: string;
			};
	  }
	| { operation: 'collaboration.sendMessage'; value: { sequence: number } }
	| { operation: 'collaboration.readMessages'; value: CollaborationPage }
	| { operation: 'collaboration.consumeMessages'; value: { consumedThrough: number } }
	| { operation: 'collaboration.readFact' | 'collaboration.writeFact'; value: { fact: CollaborationFact | null } };

export interface ChildOutputPage {
	sha256: string;
	originalBytes: number;
	offset: number;
	nextOffset: number | null;
	text: string;
}
