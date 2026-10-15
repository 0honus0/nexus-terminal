import { agentRecord, agentText, agentInteger, InvalidAgentPayload } from '../http-codec.js';
import { AGENT_BROWSER_MAX_BODY_BYTES, AGENT_BROWSER_MAX_TARGETS } from './browser-values.js';
import type { AgentBrowserTarget, AgentBrowserConfiguration } from './browser-model.js';
import type { AgentBrowserUpdateRequest } from './browser-http.js';

function boolean(input: unknown): boolean {
	if (typeof input !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return input;
}

export function readAgentBrowserTargets(input: unknown): AgentBrowserTarget[] {
	if (!Array.isArray(input) || input.length > AGENT_BROWSER_MAX_TARGETS) {
		throw new InvalidAgentPayload();
	}
	const targets = input.map((value) => {
		const row = agentRecord(value, ['id', 'endpoints', 'allowedUrlPatterns'], AGENT_BROWSER_MAX_BODY_BYTES);
		const id = agentText(row.id, 128);
		if (!/^[a-z][a-z0-9_-]*$/u.test(id)) {
			throw new InvalidAgentPayload();
		}
		if (
			!Array.isArray(row.endpoints) ||
			!row.endpoints.length ||
			row.endpoints.length > 8 ||
			!Array.isArray(row.allowedUrlPatterns) ||
			!row.allowedUrlPatterns.length ||
			row.allowedUrlPatterns.length > 32
		) {
			throw new InvalidAgentPayload();
		}
		const endpoints = row.endpoints.map((value) => {
			const endpoint = agentRecord(value, ['url', 'priority', 'allowPlaintext', 'verifyTls']);
			const url = agentText(endpoint.url, 4096);
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
				priority: agentInteger(endpoint.priority, 0, 100),
				allowPlaintext,
				verifyTls: boolean(endpoint.verifyTls),
			};
		});
		const allowedUrlPatterns = row.allowedUrlPatterns.map((value) => {
			const pattern = agentText(value, 2048);
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

export function readAgentBrowserUpdate(input: unknown): AgentBrowserUpdateRequest {
	const row = agentRecord(input, ['expectedVersion', 'targets'], AGENT_BROWSER_MAX_BODY_BYTES);
	return { expectedVersion: agentInteger(row.expectedVersion, 1), targets: readAgentBrowserTargets(row.targets) };
}

export function readAgentBrowserConfiguration(input: unknown): AgentBrowserConfiguration {
	const row = agentRecord(input, ['version', 'targets'], AGENT_BROWSER_MAX_BODY_BYTES);
	return { version: agentInteger(row.version, 1), targets: readAgentBrowserTargets(row.targets) };
}
