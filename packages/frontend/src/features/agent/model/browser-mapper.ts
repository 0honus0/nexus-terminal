import type { AgentBrowserConfiguration } from '@nexus-terminal/shared/agent/integrations/browser-model';
import type { AgentBrowserUpdateRequest } from '@nexus-terminal/shared/agent/integrations/browser-http';
import type { BrowserConfiguration, BrowserTargetDraft } from './browser-types';

export function fromBrowserConfiguration(value: AgentBrowserConfiguration): BrowserConfiguration {
	return {
		version: value.version,
		targets: value.targets.map((target) => ({
			id: target.id,
			patternsText: target.allowedUrlPatterns.join('\n'),
			endpoints: target.endpoints.map((endpoint) => ({
				url: endpoint.url,
				priority: endpoint.priority,
				allowPlaintext: endpoint.allowPlaintext,
				verifyTls: endpoint.verifyTls,
			})),
		})),
	};
}

export function toBrowserUpdate(version: number, targets: BrowserTargetDraft[]): AgentBrowserUpdateRequest {
	return {
		expectedVersion: version,
		targets: targets.map((target) => ({
			id: target.id,
			allowedUrlPatterns: target.patternsText
				.split('\n')
				.map((pattern) => pattern.trim())
				.filter(Boolean),
			endpoints: target.endpoints.map((endpoint) => ({
				url: endpoint.url,
				priority: endpoint.priority,
				allowPlaintext: endpoint.allowPlaintext,
				verifyTls: endpoint.verifyTls,
			})),
		})),
	};
}
