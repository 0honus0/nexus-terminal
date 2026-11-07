/** Historical records retained for snapshot verification and explicit data removal, never runtime connectors. */
export type StoredIntegrationConfiguration =
	| {
			kind: 'mcp';
			displayName: string;
			endpoint: string;
			privateHostExceptions: string[];
			protocolVersion: '2026-07-28';
	  }
	| { kind: 'acp'; displayName: string; connectionId: number; argv: string[]; cwd: string; protocolVersion: '1' };

export interface StoredIntegration {
	id: string;
	appId: string;
	configuration: StoredIntegrationConfiguration;
	enabled: boolean;
	encryptedCredential: string | null;
	credentialRevision: number;
	schemaHash: string | null;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface StoredIntegrationReceipt {
	id: string;
	appId: string;
	configuration: StoredIntegrationConfiguration;
	enabled: boolean;
	hasCredential: boolean;
	credentialRevision: number;
	schemaHash: string | null;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface StoredIntegrationRejection {
	userId: number;
	appId: string;
	key: string;
	intentHash: string;
}
