export type StoredPluginConnector =
	| { kind: 'none' }
	| { kind: 'http'; endpoint: string; privateAuthorities: string[] }
	| { kind: 'remoteProcess'; connectionId: number; argv: string[]; cwd: string };

export interface StoredPluginConnection {
	instanceId: string;
	revision: number;
	connector: StoredPluginConnector;
	encryptedCredential: string | null;
}

export interface PluginConnectionStorage {
	read(userId: number, appId: string, instanceId: string, digest: string | null): Promise<StoredPluginConnection>;
	write(
		userId: number,
		appId: string,
		instanceId: string,
		digest: string,
		expectedRevision: number,
		connector: StoredPluginConnector,
		credential: { action: 'keep' } | { action: 'replace'; encrypted: string | null },
	): Promise<StoredPluginConnection>;
}

export class PluginConnectionRefusal extends Error {
	constructor(readonly code: 'not_found' | 'version_conflict' | 'unauthenticated' | 'forbidden') {
		super(code);
		this.name = 'PluginConnectionRefusal';
	}
}
