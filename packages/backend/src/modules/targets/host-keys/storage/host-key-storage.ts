/** Host key trust is distinct from a Connection's configuration fingerprint. */
export interface HostKeyRecord {
	host: string;
	port: number;
	fingerprint: string;
	confirmedAt: number;
}

export interface ConfirmHostKeyRecord {
	host: string;
	port: number;
	fingerprint: string;
}

export interface HostKeyStorage {
	list(): Promise<HostKeyRecord[]>;
	confirm(command: ConfirmHostKeyRecord): Promise<HostKeyRecord>;
	remove(host: string, port: number): Promise<boolean>;
}
