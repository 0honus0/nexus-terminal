import type {
	AgentBrowserTarget,
	AgentBrowserConfiguration,
} from '@nexus-terminal/shared/agent/integrations/browser-model';
import type { BrowserTarget, BrowserConfiguration } from '../../integrations/model/browser-types.js';

export function toBrowserTargets(targets: AgentBrowserTarget[]): BrowserTarget[] {
	return targets.map((target) => ({
		id: target.id,
		endpoints: target.endpoints.map((endpoint) => ({
			url: endpoint.url,
			priority: endpoint.priority,
			allowPlaintext: endpoint.allowPlaintext,
			verifyTls: endpoint.verifyTls,
		})),
		allowedUrlPatterns: target.allowedUrlPatterns.map((pattern) => pattern),
	}));
}

export function toBrowserView(value: BrowserConfiguration): AgentBrowserConfiguration {
	return {
		version: value.version,
		targets: value.targets.map((target) => ({
			id: target.id,
			endpoints: target.endpoints.map((endpoint) => ({
				url: endpoint.url,
				priority: endpoint.priority,
				allowPlaintext: endpoint.allowPlaintext,
				verifyTls: endpoint.verifyTls,
			})),
			allowedUrlPatterns: target.allowedUrlPatterns.map((pattern) => pattern),
		})),
	};
}
