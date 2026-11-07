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

export interface PluginConnectionWrite {
	expectedRevision: number;
	connector: PluginConnector;
	credential: { action: 'keep' | 'clear' } | { action: 'replace'; value: string };
}
