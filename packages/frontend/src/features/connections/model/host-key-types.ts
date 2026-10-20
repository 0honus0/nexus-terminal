export interface HostKeySummary {
	host: string;
	port: number;
	fingerprint: string;
	confirmedAt: number;
}

export interface HostKeyDraft {
	host: string;
	port: string;
	fingerprint: string;
}

export interface HostKeyTrustRequest {
	host: string;
	port: number;
	fingerprint: string;
	expectedFingerprint: string | null;
}
