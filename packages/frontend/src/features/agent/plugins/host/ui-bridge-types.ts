import type { AgentPluginFrontendInput } from '@nexus-terminal/shared/agent/plugins/frontend-events';

/** Browser-only peer attached to the authenticated plugin port by its original owner. */
export interface PluginFrontendUiBridge {
	connect(port: MessagePort): void;
	handle(input: unknown, port: MessagePort): boolean;
	authorize?(request: AgentPluginFrontendInput, signal?: AbortSignal): Promise<boolean>;
	setFailureHandler(listener: (error: unknown) => void): void;
	close(): Promise<void>;
}
