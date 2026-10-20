/** Operator-confirmed SSH public key pin, independent of a Connection fingerprint. */
export interface TargetHostKeyView {
	host: string;
	port: number;
	fingerprint: string;
	confirmedAt: number;
}

/** Actual handshake observation; never establishes trust without operator confirmation. */
export interface TargetHostKeyChallenge {
	host: string;
	port: number;
	fingerprint: string;
	expectedFingerprint: string | null;
}
