import type { TargetHostKeyView } from '@nexus-terminal/shared/targets/host-keys/model';
import type { ProxyType } from '@nexus-terminal/shared/targets/proxies/values';
import type { TargetConnectionInput, TargetImportInput, TargetCredentialInput } from '@nexus-terminal/shared/targets/connections/http';
import type { TargetConnectionView } from '@nexus-terminal/shared/targets/connections/model';
import type { TargetConnectionMutation } from '@nexus-terminal/shared/targets/connections/model';
import type { TargetImportItem, TargetCredentialMutation } from '@nexus-terminal/shared/targets/connections/http';
import type { TargetProxyInput, TargetProxyChanges } from '@nexus-terminal/shared/targets/proxies/http';
import type { TargetProxyView } from '@nexus-terminal/shared/targets/proxies/model';
import type { TargetProxyMutation } from '@nexus-terminal/shared/targets/proxies/model';
import type { TargetTagView } from '@nexus-terminal/shared/targets/tags/model';
import type { TargetTagMutation } from '@nexus-terminal/shared/targets/tags/model';
import type { TargetSshKeyInput, TargetSshKeyChanges } from '@nexus-terminal/shared/targets/ssh-keys/http';
import type { TargetSshKeyView } from '@nexus-terminal/shared/targets/ssh-keys/model';
import type { TargetSshKeyMutation } from '@nexus-terminal/shared/targets/ssh-keys/model';

/**
 * Management types are the exact Shared contract consumed by Frontend.
 * Internal Service and Storage types remain independent and are always mapped
 * explicitly at registerTargets. Trusted resolved targets are backend-only.
 */
export type ConnectionMetadata = TargetConnectionInput;

export type ConnectionSnapshot = TargetConnectionView;

export type ConnectionMutation = TargetConnectionMutation;

export type ConnectionImport = TargetImportInput;

export type ImportItemResult = TargetImportItem;

export type ProxyInput = TargetProxyInput;

export type ProxyUpdateInput = TargetProxyChanges;

export type ProxyView = TargetProxyView;

export type ProxyMutation = TargetProxyMutation;

export type TagView = TargetTagView;

export type TagMutation = TargetTagMutation;

export type SshKeyInput = TargetSshKeyInput;

export type SshKeyChanges = TargetSshKeyChanges;

export type SshKeyView = TargetSshKeyView;

export type SshKeyMutation = TargetSshKeyMutation;

export type SshCredentialInput = TargetCredentialInput;

export type CredentialMutation = TargetCredentialMutation;

/** A pinned SSH host public key is NOT a Connection configuration fingerprint. */
export type HostKeyTrustView = TargetHostKeyView;

export interface HostKeyManagement {
	list(): Promise<HostKeyTrustView[]>;
	/** Confirmation requires the human to compare the fingerprint out of band. */
	confirm(input: { host: string; port: number; fingerprint: string }): Promise<HostKeyTrustView>;
	remove(host: string, port: number): Promise<boolean>;
}

export interface ConnectionCatalog {
	list(): Promise<ConnectionSnapshot[]>;
	get(id: number): Promise<ConnectionSnapshot | null>;
}

export interface ConnectionMutations {
	create(data: ConnectionMetadata): Promise<ConnectionSnapshot>;
	update(id: number, version: number, changes: Partial<ConnectionMetadata>): Promise<ConnectionMutation>;
	clone(id: number, name: string): Promise<ConnectionSnapshot | null>;
	delete(id: number): Promise<boolean>;
	setTags(id: number, version: number, tags: number[]): Promise<ConnectionMutation>;
	importOne(command: ConnectionImport): Promise<ConnectionSnapshot>;
	importMany(commands: ConnectionImport[]): Promise<ImportItemResult[]>;
}

export interface ProxyManagement {
	list(): Promise<ProxyView[]>;
	get(id: number): Promise<ProxyView | null>;
	create(data: ProxyInput): Promise<ProxyView>;
	update(id: number, version: number, patch: ProxyUpdateInput): Promise<ProxyMutation>;
	delete(id: number): Promise<boolean>;
}

export interface TagManagement {
	list(): Promise<TagView[]>;
	get(id: number): Promise<TagView | null>;
	create(name: string): Promise<TagView>;
	rename(id: number, version: number, name: string): Promise<TagMutation>;
	delete(id: number): Promise<boolean>;
}

export interface SshKeyManagement {
	list(): Promise<SshKeyView[]>;
	get(id: number): Promise<SshKeyView | null>;
	create(data: SshKeyInput): Promise<SshKeyView>;
	update(id: number, version: number, changes: SshKeyChanges): Promise<SshKeyMutation>;
	delete(id: number): Promise<boolean>;
}

export interface ConnectionCredentialManagement {
	set(id: number, version: number, input: SshCredentialInput): Promise<CredentialMutation>;
	clear(id: number, version: number): Promise<CredentialMutation>;
}

export type TargetsPublicApi = ConnectionCatalog &
	ConnectionMutations & {
		proxies: ProxyManagement;
		tags: TagManagement;
		sshKeys: SshKeyManagement;
		credentials: ConnectionCredentialManagement;
		hostKeys: HostKeyManagement;
	};

/** Trusted backend-only machine connection output. Never expose via management HTTP. */
export type TrustedSshAuthentication =
	{ kind: 'password'; password: string } | { kind: 'ssh_key'; privateKey: string; passphrase: string | null };

export interface TrustedSshProxy {
	type: ProxyType;
	host: string;
	port: number;
	username: string | null;
	password: string | null;
}

export interface TrustedResolvedSshTarget {
	readonly id: number;
	readonly host: string;
	readonly port: number;
	readonly username: string;
	readonly authentication: TrustedSshAuthentication;
	readonly proxy: TrustedSshProxy | null;
	readonly jumps: readonly TrustedResolvedSshTarget[];
	readonly fingerprint: string;
}

export interface TrustedSshTargetResolver {
	fingerprintStored(id: number): Promise<string>;
	resolveStored(id: number): Promise<TrustedResolvedSshTarget>;
}
