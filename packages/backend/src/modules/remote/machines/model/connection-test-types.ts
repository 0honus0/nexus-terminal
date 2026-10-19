export interface UnsavedConnectionTest {
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

export type ConnectionTestCommand =
	{ kind: 'stored'; targetId: number } | { kind: 'unsaved'; target: UnsavedConnectionTest };

export interface ConnectionTestResult {
	latencyMs: number;
}

export interface ConnectionTestScope {
	signal: AbortSignal;
	timeoutMs: number;
	validate(): Promise<void>;
}
