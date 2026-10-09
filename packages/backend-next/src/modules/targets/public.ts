import type { ConnectionRoute, ConnectionType } from '@nexus-terminal/shared/connections/values';
import type { ProxyType } from '@nexus-terminal/shared/proxies/values';
import type { TargetErrorCode } from './public-errors.js';

/**
 * Stable cross-module boundary. Never import storage records or internal
 * Service/Model DTOs here. Every value is projected by public-mappers.ts.
 */
export interface ConnectionMetadata {
	name: string;
	type: ConnectionType;
	host: string;
	port: number;
	username: string;
	route: ConnectionRoute;
	proxyId: number | null;
	notes: string | null;
	rdpRemoteApp: string | null;
	rdpRemoteAppDirectory: string | null;
	rdpRemoteAppArguments: string | null;
	tagIds: number[];
	jumpIds: number[];
}
export interface ConnectionSnapshot extends ConnectionMetadata {
	id: number;
	version: number;
	createdAt: number;
	updatedAt: number;
}
export type ConnectionMutation =
	{ status: 'updated'; value: ConnectionSnapshot } | { status: 'not_found' } | { status: 'version_conflict' };

export interface ProxyInput {
	name: string;
	type: ProxyType;
	host: string;
	port: number;
	username: string | null;
	password?: string | null;
}
export interface ProxyUpdateInput {
	name?: string;
	type?: ProxyType;
	host?: string;
	port?: number;
	username?: string | null;
	password?: string | null;
}
export interface ProxyView {
	id: number;
	name: string;
	type: ProxyType;
	host: string;
	port: number;
	username: string | null;
	version: number;
	createdAt: number;
	updatedAt: number;
}
export type ProxyMutation =
	{ status: 'updated'; value: ProxyView } | { status: 'not_found' } | { status: 'version_conflict' };

export interface TagView {
	id: number;
	name: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}
export type TagMutation =
	{ status: 'updated'; value: TagView } | { status: 'not_found' } | { status: 'version_conflict' };

export interface SshKeyInput {
	name: string;
	privateKey: string;
	passphrase?: string | null;
}
export interface SshKeyChanges {
	name?: string;
	privateKey?: string;
	passphrase?: string | null;
}
export interface SshKeyView {
	id: number;
	name: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}
export type SshKeyMutation =
	{ status: 'updated'; value: SshKeyView } | { status: 'not_found' } | { status: 'version_conflict' };

export type SshCredentialInput = { kind: 'password'; password: string } | { kind: 'ssh_key'; sshKeyId: number };
export type CredentialMutation = { status: 'updated' } | { status: 'not_found' } | { status: 'version_conflict' };

export interface ConnectionImport {
	connection: ConnectionMetadata;
	inlineProxy?: Omit<ProxyInput, 'password'>;
	tagNames?: string[];
}
export type ImportItemResult = { status: 'ok'; id: number } | { status: 'error'; code: TargetErrorCode };

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
