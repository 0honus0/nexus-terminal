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
