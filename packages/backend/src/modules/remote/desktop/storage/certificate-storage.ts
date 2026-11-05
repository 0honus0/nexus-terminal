export interface StoredCertificateTrust {
	userId: number;
	host: string;
	port: number;
	fingerprint: string;
	confirmedAt: number;
}

export interface ConfirmCertificateTrust {
	userId: number;
	host: string;
	port: number;
	fingerprint: string;
	previousFingerprint: string | null;
}

export class CertificateTrustStorageConflict extends Error {
	constructor() {
		super('Certificate trust changed');
	}
}

export interface CertificateTrustStorage {
	get(userId: number, host: string, port: number): Promise<StoredCertificateTrust | null>;
	confirm(command: ConfirmCertificateTrust, digest: string, admit: (identity: number | null) => void): Promise<void>;
}
