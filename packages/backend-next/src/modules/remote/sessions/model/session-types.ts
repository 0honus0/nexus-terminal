/** Remote-owned session identity and user-facing metadata. */
export interface RemoteSessionSnapshot {
	readonly id: string;
	readonly targetId: number;
	readonly fingerprint: string;
	readonly startedAt: number;
	readonly status: 'open' | 'closed';
}
