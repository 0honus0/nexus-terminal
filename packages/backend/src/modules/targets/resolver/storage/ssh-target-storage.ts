import type { ProxyType } from '@nexus-terminal/shared/targets/proxies/values';

/** Snapshot lookup refusals; the Model owns their application meaning. */
export class SshTargetStorageRefusal extends Error {
	constructor(readonly reason: 'missing_reference' | 'missing_credential' | 'unsupported_target' | 'invalid_graph') {
		super('SSH snapshot refused: ' + reason);
		this.name = 'SshTargetStorageRefusal';
	}
}

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
	get(id: number, limits: SshSnapshotLimits): Promise<EncodedSshTarget>;
	references(request: SshReferenceLookup, limits: SshSnapshotLimits): Promise<EncodedSshReferences>;
}

export interface SshSnapshotLimits {
	maxDepth: number;
	maxExpanded: number;
}

export interface SshReferenceLookup {
	sshKeyId: number | null;
	proxyId: number | null;
	jumpIds: number[];
}

export interface EncodedSshReferences {
	key: { privateKey: string; passphrase: string | null } | null;
	proxy: EncodedSshTarget['proxy'];
	jumps: EncodedSshTarget[];
}
