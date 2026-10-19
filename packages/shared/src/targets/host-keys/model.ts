/** Operator-confirmed SSH public key pin, independent of a Connection fingerprint. */
export interface TargetHostKeyView {
	host: string;
	port: number;
	fingerprint: string;
	confirmedAt: number;
}
