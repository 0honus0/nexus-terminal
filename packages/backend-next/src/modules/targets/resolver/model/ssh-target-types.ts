import type { ProxyType } from '@nexus-terminal/shared/proxies/values';

/** Trusted backend-only machine configuration; must never be serialized to an HTTP response. */
export type ResolvedAuthentication =
	{ kind: 'password'; password: string } | { kind: 'ssh_key'; privateKey: string; passphrase: string | null };

export interface ResolvedProxy {
	type: ProxyType;
	host: string;
	port: number;
	username: string | null;
	password: string | null;
}

export interface ResolvedSshTarget {
	readonly id: number;
	readonly host: string;
	readonly port: number;
	readonly username: string;
	readonly authentication: ResolvedAuthentication;
	readonly proxy: ResolvedProxy | null;
	readonly jumps: readonly ResolvedSshTarget[];
	readonly fingerprint: string;
}

/** Internal ciphertext snapshot. Each fingerprint comes from the same storage read. */
export interface SshTargetSnapshot {
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
	fingerprint: string;
	jumps: SshTargetSnapshot[];
}
