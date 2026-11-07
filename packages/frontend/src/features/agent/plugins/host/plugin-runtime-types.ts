import type { AgentPluginFrontendSandbox } from '@nexus-terminal/shared/agent/plugins/values';
import type { PluginPackageReference } from '../model/plugin-types';

export interface PluginFrontendDescriptor {
	purpose: 'app' | 'settings';
	instanceId: string;
	appId: string;
	package: PluginPackageReference;
	uiRevision: number;
	version: string;
	url: string;
	grant: string;
	sdkVersion: string;
	protocolVersion: 4;
	sandbox: AgentPluginFrontendSandbox;
	maxMessageBytes: number;
	requestTimeoutMs: number;
	expiresAt: number;
}
