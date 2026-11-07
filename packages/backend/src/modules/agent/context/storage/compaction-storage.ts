import type { StoredContextSnapshot } from './context-storage.js';

export interface StoredCompaction {
	id: string;
	rootId: string;
	runId: string;
	stepIndex: number;
	state: 'reserved' | 'dispatched' | 'completed' | 'failed' | 'unknown';
	source: StoredContextSnapshot;
	cut: number;
	summary: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
}
