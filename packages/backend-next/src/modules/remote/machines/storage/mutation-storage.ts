export interface StoredMutationClaim {
	id: string;
	keys: string[];
	now: number;
}

export interface MachineMutationStorage {
	acquire(claim: StoredMutationClaim, maxClaims: number): Promise<'acquired' | 'conflict' | 'limit_exceeded'>;
	settle(id: string, keys: string[], blocked: boolean): Promise<void>;
	reconcile(): Promise<void>;
}
