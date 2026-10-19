import type { ProxyType } from '@nexus-terminal/shared/targets/proxies/values';

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

/** One storage snapshot; the expected fingerprint is checked before decrypt. */
export interface ResolveSshTargetRequest {
	targetId: number;
	expectedFingerprint?: string;
}

export interface UnsavedSshTargetInput {
	host: string;
	port: number;
	username: string;
	authentication:
		| { kind: 'password'; password: string }
		| { kind: 'ssh_key'; sshKeyId: number }
		| { kind: 'private_key'; privateKey: string; passphrase: string | null };
	route: import('@nexus-terminal/shared/targets/connections/values').ConnectionRoute;
	proxyId: number | null;
	jumpIds: number[];
}

export interface SshResolutionLimits {
	maxJumpEdges: number;
	maxExpandedTargets: number;
}

export interface ResolvedUnsavedSshTarget {
	host: string;
	port: number;
	username: string;
	authentication: ResolvedAuthentication;
	proxy: ResolvedProxy | null;
	jumps: readonly ResolvedSshTarget[];
}
