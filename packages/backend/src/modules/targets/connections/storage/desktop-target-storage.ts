import type { ConnectionType, ConnectionRoute } from '@nexus-terminal/shared/targets/connections/values';

/** Storage-only snapshot: ciphertext never crosses the trusted Targets boundary. */
export interface StoredDesktopTarget {
	id: number;
	version: number;
	type: ConnectionType;
	host: string;
	port: number;
	username: string;
	route: ConnectionRoute;
	rdpRemoteApp: string | null;
	rdpRemoteAppDirectory: string | null;
	rdpRemoteAppArguments: string | null;
	encryptedPassword: string | null;
}

export interface DesktopTargetStorage {
	get(id: number): Promise<StoredDesktopTarget | null>;
	markAttempt(id: number, version: number, timestamp: number): Promise<boolean>;
}
