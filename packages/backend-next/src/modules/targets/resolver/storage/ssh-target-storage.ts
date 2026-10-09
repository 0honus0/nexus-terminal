import type { ProxyType } from '@nexus-terminal/shared/proxies/values';

export interface EncodedSshTarget {
	id: number;
	host: string;
	port: number;
	username: string;
	credential:
		| { kind: 'password'; ciphertext: string }
		| { kind: 'ssh_key'; keyId: number; privateKey: string; passphrase: string | null };
	proxy: {
		id: number;
		type: ProxyType;
		host: string;
		port: number;
		username: string | null;
		ciphertext: string | null;
	} | null;
	jumps: EncodedSshTarget[];
}
export interface SshTargetStorage {
	get(id: number): Promise<EncodedSshTarget>;
}
