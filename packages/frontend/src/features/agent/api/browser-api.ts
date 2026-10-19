import {
	readAgentBrowserConfiguration,
	readAgentBrowserUpdate,
} from '@nexus-terminal/shared/agent/integrations/browser-http-codec';
import type { AgentBrowserUpdateRequest } from '@nexus-terminal/shared/agent/integrations/browser-http';
import { AGENT_BROWSER_MAX_BODY_BYTES } from '@nexus-terminal/shared/agent/integrations/browser-values';
import { structurallyEqual } from '@/foundation/data';
import { fromBrowserConfiguration, toBrowserUpdate } from '../model/browser-mapper';
import type { BrowserConfiguration, BrowserTargetDraft } from '../model/browser-types';
import { requestAgentManagement } from './management-request';

export async function getBrowserConfiguration(signal?: AbortSignal): Promise<BrowserConfiguration> {
	const value = await requestAgentManagement({
		method: 'GET',
		path: '/browser/configuration',
		maxRequestBytes: AGENT_BROWSER_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_BROWSER_MAX_BODY_BYTES,
		decode: readAgentBrowserConfiguration,
		signal,
	});
	return fromBrowserConfiguration(value);
}

export async function saveBrowserConfiguration(
	version: number,
	targets: BrowserTargetDraft[],
	signal?: AbortSignal,
): Promise<BrowserConfiguration> {
	let expected: AgentBrowserUpdateRequest | null = null;
	const value = await requestAgentManagement({
		method: 'PUT',
		path: '/browser/configuration',
		maxRequestBytes: AGENT_BROWSER_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_BROWSER_MAX_BODY_BYTES,

		input() {
			expected = readAgentBrowserUpdate(toBrowserUpdate(version, targets));
			return expected;
		},

		decode(value) {
			const result = readAgentBrowserConfiguration(value);
			if (!expected || result.version !== version + 1 || !structurallyEqual(result.targets, expected.targets)) {
				throw new Error('Browser confirmation does not match submitted configuration');
			}
			return result;
		},

		signal,
	});
	return fromBrowserConfiguration(value);
}
