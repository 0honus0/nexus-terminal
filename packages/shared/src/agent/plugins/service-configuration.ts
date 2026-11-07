/** Stable configuration ownership is separate from a currently loaded package version. */
export interface AgentPluginServiceConfigurationProvider {
	packageId: string;
	publisherKeyId: string;
	service: string;
}

export type AgentPluginServiceConfigurationOwner =
	{ kind: 'unassigned' } | { kind: 'service'; provider: AgentPluginServiceConfigurationProvider };

export type AgentPluginServiceConnector =
	| { kind: 'none' }
	| { kind: 'http'; endpoint: string; privateHostExceptions: string[] }
	| { kind: 'remoteProcess'; connectionId: number; argv: string[]; cwd: string };

export interface AgentPluginServiceConfiguration {
	displayName: string;
	publicConfigurationJson: string;
	connector: AgentPluginServiceConnector;
}

export interface AgentPluginServiceConfigurationView {
	id: string;
	appId: string;
	owner: AgentPluginServiceConfigurationOwner;
	configuration: AgentPluginServiceConfiguration;
	enabled: boolean;
	hasCredential: boolean;
	credentialRevision: number;
	version: number;
	createdAt: number;
	updatedAt: number;
}

/** Only Host's trusted secret interaction can mint a replacement token. */
export type AgentPluginServiceConfigurationCredential =
	{ action: 'keep' } | { action: 'clear' } | { action: 'replace'; changeToken: string };

export interface AgentPluginServiceConfigurationCreate {
	operationKey: string;
	configuration: AgentPluginServiceConfiguration;
	enabled: boolean;
	credential: AgentPluginServiceConfigurationCredential;
}

export interface AgentPluginServiceConfigurationUpdate {
	id: string;
	expectedVersion: number;
	configuration: AgentPluginServiceConfiguration;
	enabled: boolean;
	credential: AgentPluginServiceConfigurationCredential;
}

export interface AgentPluginServiceConfigurationVersion {
	id: string;
	expectedVersion: number;
}

export type AgentPluginServiceConfigurationCreateResponse =
	| { status: 'created'; operationKey: string; configuration: AgentPluginServiceConfigurationView }
	| { status: 'not_created'; operationKey: string };

export type AgentPluginServiceConfigurationReceipt =
	AgentPluginServiceConfigurationCreateResponse | { status: 'unrecorded'; operationKey: string };

/** App/provider authority always comes from the current settings or managed service control. */
export type AgentPluginServiceConfigurationRequest =
	| { method: 'configuration.list'; params: Record<string, never> }
	| { method: 'configuration.get'; params: { id: string } }
	| { method: 'configuration.create'; params: AgentPluginServiceConfigurationCreate }
	| { method: 'configuration.update'; params: AgentPluginServiceConfigurationUpdate }
	| { method: 'configuration.delete'; params: AgentPluginServiceConfigurationVersion }
	| { method: 'configuration.adopt'; params: AgentPluginServiceConfigurationUpdate }
	| { method: 'configuration.receipt'; params: { operationKey: string } };

export type AgentPluginServiceConfigurationResult =
	| { method: 'configuration.list'; value: { items: AgentPluginServiceConfigurationView[] } }
	| {
			method: 'configuration.get' | 'configuration.update' | 'configuration.adopt';
			value: AgentPluginServiceConfigurationView;
	  }
	| { method: 'configuration.create'; value: AgentPluginServiceConfigurationCreateResponse }
	| { method: 'configuration.delete'; value: { status: 'deleted' } }
	| { method: 'configuration.receipt'; value: AgentPluginServiceConfigurationReceipt };
