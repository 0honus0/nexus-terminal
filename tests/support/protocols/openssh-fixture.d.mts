export interface OpenSshDaemon {
	port: number;
	user: string;
	fingerprint: string;
	privateKey: string;
	close(): Promise<void>;
}

export function openSshd(directory: string): Promise<OpenSshDaemon>;
