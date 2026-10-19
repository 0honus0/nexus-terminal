export interface AgentPluginRuntimeAcknowledgement {
	expectedRevision: number;
	instanceRevision: number;
	instanceId: string;
	confirmed: true;
}
