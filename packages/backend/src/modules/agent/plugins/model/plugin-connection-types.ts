export type PluginConnector =
	| { kind: 'none' }
	| { kind: 'http'; endpoint: string; privateAuthorities: string[] }
	| { kind: 'remoteProcess'; connectionId: number; argv: string[]; cwd: string };

export interface PluginConnection {
	instanceId: string;
	revision: number;
	connector: PluginConnector;
	hasCredential: boolean;
}

export interface PluginConnectionSource {
	connection: PluginConnection;
	/** Only the trusted transport adapter may consume this credential. */
	credential: string | null;
}

export interface PluginConnectionWrite {
	expectedRevision: number;
	connector: PluginConnector;
	credential: { action: 'keep' } | { action: 'clear' } | { action: 'replace'; value: string };
}
