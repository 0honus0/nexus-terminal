export interface StoredRunAppMutation {
	userId: number;
	appId: string;
	runId: string;
	creationHash: string;
	executionGeneration: string;
	expectedVersion: number;
	now: number;
}

export type StoredRunAppTerminal =
	| { state: 'completed'; outputJson: string }
	| { state: 'failed' | 'unknown' }
	| {
			state: 'suspended';
			checkpointVersion: number;
			inputRequest: { id: string; sha256: string; sizeBytes: number; mediaType: string };
	  };

export type StoredRunAppResult =
	| { status: 'ok'; version: number }
	| { status: 'not_found' | 'version_conflict' | 'scope_closed' | 'operation_conflict' };
