export interface MachineMutationTarget {
	targetId: number;
	fingerprint: string;
}

export interface MachineMutationClaim {
	id: string;
	keys: string[];
}
