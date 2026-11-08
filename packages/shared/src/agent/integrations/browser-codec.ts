import { agentRecord, agentText, agentInteger, InvalidAgentPayload } from '../http-codec.js';
import {
	AGENT_BROWSER_ENDPOINT_MAX_BYTES,
	AGENT_BROWSER_PATTERN_MAX_BYTES,
	AGENT_BROWSER_TARGET_ID_MAX_BYTES,
} from './browser-values.js';
import type { AgentBrowserTarget, AgentBrowserPluginConfiguration } from './browser-model.js';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from '../plugins/values.js';

function boolean(input: unknown): boolean {
	if (typeof input !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return input;
}

export function readAgentBrowserTargets(input: unknown): AgentBrowserTarget[] {
	if (!Array.isArray(input)) {
		throw new InvalidAgentPayload();
	}
	const targets = input.map((value) => {
		const row = agentRecord(value, ['id', 'endpoints', 'allowedUrlPatterns'], AGENT_PLUGIN_MAX_MESSAGE_BYTES);
		const id = agentText(row.id, AGENT_BROWSER_TARGET_ID_MAX_BYTES);
		if (!/^[a-z][a-z0-9_-]*$/u.test(id)) {
			throw new InvalidAgentPayload();
		}
		if (
			!Array.isArray(row.endpoints) ||
			!row.endpoints.length ||
			!Array.isArray(row.allowedUrlPatterns) ||
			!row.allowedUrlPatterns.length
		) {
			throw new InvalidAgentPayload();
		}
		const endpoints = row.endpoints.map((value) => {
			const endpoint = agentRecord(value, ['url', 'priority', 'allowPlaintext', 'verifyTls']);
			const url = agentText(endpoint.url, AGENT_BROWSER_ENDPOINT_MAX_BYTES);
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				throw new InvalidAgentPayload();
			}
			const allowPlaintext = boolean(endpoint.allowPlaintext);
			if (
				!['ws:', 'wss:'].includes(parsed.protocol) ||
				parsed.username ||
				parsed.password ||
				parsed.hash ||
				(parsed.protocol === 'ws:' && !allowPlaintext)
			) {
				throw new InvalidAgentPayload();
			}
			return {
				url: parsed.toString(),
				priority: agentInteger(endpoint.priority, 0),
				allowPlaintext,
				verifyTls: boolean(endpoint.verifyTls),
			};
		});
		const allowedUrlPatterns = row.allowedUrlPatterns.map((value) => {
			const pattern = agentText(value, AGENT_BROWSER_PATTERN_MAX_BYTES);
			let url: URL;
			try {
				url = new URL(pattern);
			} catch {
				throw new InvalidAgentPayload();
			}
			if (
				!['http:', 'https:'].includes(url.protocol) ||
				url.username ||
				url.password ||
				url.hash ||
				url.hostname.includes('*') ||
				url.search ||
				(url.pathname.includes('*') &&
					(!url.pathname.endsWith('*') || url.pathname.indexOf('*') !== url.pathname.length - 1))
			) {
				throw new InvalidAgentPayload();
			}
			return url.toString();
		});
		return { id, endpoints, allowedUrlPatterns };
	});
	if (new Set(targets.map((target) => target.id)).size !== targets.length) {
		throw new InvalidAgentPayload();
	}
	return targets;
}

export function readAgentBrowserPluginConfiguration(input: unknown): AgentBrowserPluginConfiguration {
	const row = agentRecord(input, ['targets'], AGENT_PLUGIN_MAX_MESSAGE_BYTES);
	return { targets: readAgentBrowserTargets(row.targets) };
}
