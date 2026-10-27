export interface HostKeyTrust {
	host: string;
	port: number;
	fingerprint: string;
	confirmedAt: number;
}

export interface ConfirmHostKey {
	host: string;
	port: number;
	fingerprint: string;
}
