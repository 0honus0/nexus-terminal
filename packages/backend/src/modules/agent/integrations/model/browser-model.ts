import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import type { BrowserClient, BrowserSession } from '../../../../platform/browser/browser-client.js';
import { BrowserFailure } from '../../../../platform/browser/browser-client.js';
import { AgentFailure, ToolCleanupFailure, ToolExecutionUnknown, ToolOperationRefusal } from '../../agent-failure.js';
import { readAgentBrowserPluginConfiguration } from '@nexus-terminal/shared/agent/integrations/browser-codec';
import type {
	BrowserConfigurationSource,
	BrowserConfiguration,
	BrowserSnapshot,
	BrowserSessionAction,
	BrowserReply,
	BrowserApplicationSession,
} from './browser-types.js';

function failure(error: unknown, mutation = false): never {
	if (error instanceof BrowserFailure) {
		if (error.kind === 'cleanup_failed') {
			throw new ToolCleanupFailure({ cause: error });
		}
		if (error.kind === 'stale_snapshot') {
			throw new ToolOperationRefusal('version_conflict', { cause: error });
		}
		if (error.kind === 'limit_exceeded') {
			throw new AgentFailure('limit_exceeded', { cause: error });
		}
		if (error.kind === 'url_denied') {
			throw new ToolOperationRefusal('target_denied', { cause: error });
		}
		if (error.kind === 'execution_unknown' || mutation) {
			throw new ToolExecutionUnknown({ cause: error });
		}
	}
	if (mutation) {
		throw new ToolExecutionUnknown({ cause: error });
	}
	throw new AgentFailure('provider_unavailable', { cause: error });
}

class ApplicationBrowserSession implements BrowserApplicationSession {
	constructor(private readonly session: BrowserSession) {}

	get maxUploadBytes(): number {
		return this.session.maxUploadBytes;
	}

	async snapshot(maxNodes: number, signal: AbortSignal): Promise<BrowserSnapshot> {
		try {
			const value = await this.session.snapshot(maxNodes, AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES, signal);
			return {
				snapshotId: value.snapshotId,
				url: value.url,
				title: value.title,
				nodes: value.nodes.map((node) => ({
					ref: node.ref,
					parentRef: node.parentRef,
					tag: node.tag,
					text: node.text,
					attributes: node.attributes.map((attribute) => ({ name: attribute.name, value: attribute.value })),
				})),
				truncated: value.truncated,
			};
		} catch (error) {
			failure(error);
		}
	}

	async screenshot(maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
		try {
			return (await this.session.screenshot(maxBytes, signal)).slice();
		} catch (error) {
			failure(error);
		}
	}

	console(
		after: number,
		limit: number,
	): { entries: { sequence: number; type: string; text: string }[]; nextCursor: number; truncated: boolean } {
		try {
			const value = this.session.console(after, limit);
			return {
				entries: value.entries.map((entry) => ({
					sequence: entry.sequence,
					type: entry.type,
					text: entry.text,
				})),
				nextCursor: value.nextCursor,
				truncated: value.truncated,
			};
		} catch (error) {
			failure(error);
		}
	}

	async perform(input: BrowserSessionAction, signal: AbortSignal): Promise<BrowserReply> {
		const action = toBrowserAction(input);
		try {
			const value = await this.session.perform(action, signal);
			return value.kind === 'page'
				? { kind: 'page', url: value.url, title: value.title }
				: {
						kind: 'file',
						url: value.url,
						name: value.name,
						mediaType: value.mediaType,
						bytes: value.bytes.slice(),
					};
		} catch (error) {
			failure(error, input.action !== 'download' && input.action !== 'wait');
		}
	}

	async close(): Promise<void> {
		try {
			await this.session.close();
		} catch (error) {
			failure(error);
		}
	}
}

export class BrowserModel {
	constructor(private readonly client: BrowserClient) {}

	async configuration(source: BrowserConfigurationSource): Promise<BrowserConfiguration> {
		const current = await source.read();
		let configuration;
		try {
			const raw: unknown = JSON.parse(current.documentJson);
			configuration = readAgentBrowserPluginConfiguration(raw);
		} catch (error) {
			if (error instanceof SyntaxError || error instanceof InvalidAgentPayload) {
				throw new AgentFailure('invalid_input', { cause: error });
			}
			throw error;
		}
		const { targets } = configuration;
		return {
			version: current.revision,
			targets: targets.map((target) => ({
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

	async connect(
		endpoint: { url: string; verifyTls: boolean },
		allowUrl: (url: string) => boolean,
		signal: AbortSignal,
	): Promise<BrowserApplicationSession> {
		try {
			return new ApplicationBrowserSession(
				await this.client.connect({ endpoint: endpoint.url, verifyTls: endpoint.verifyTls, allowUrl }, signal),
			);
		} catch (error) {
			failure(error);
		}
	}
}

function toBrowserAction(
	input: BrowserSessionAction,
): import('../../../../platform/browser/browser-client.js').BrowserAction {
	switch (input.action) {
		case 'navigate':
			return { kind: 'navigate', settleMs: input.settleMs, url: input.url };
		case 'back':
			return { kind: 'back', settleMs: input.settleMs };
		case 'scroll':
			return { kind: 'scroll', settleMs: input.settleMs, deltaX: input.deltaX, deltaY: input.deltaY };
		case 'wait':
			return { kind: 'wait', mode: input.mode, maxMillis: input.maxMillis };
		case 'press':
			return {
				kind: 'press',
				settleMs: input.settleMs,
				focus:
					input.focus === null ? null : { snapshotId: input.focus.snapshotId, nodeRef: input.focus.nodeRef },
				key: input.key,
				modifiers: input.modifiers.map((item) => item),
			};
		case 'select':
			return {
				kind: 'select',
				settleMs: input.settleMs,
				snapshotId: input.snapshotId,
				nodeRef: input.nodeRef,
				values: input.values.map((item) => item),
			};
		case 'click':
			return { kind: 'click', settleMs: input.settleMs, snapshotId: input.snapshotId, nodeRef: input.nodeRef };
		case 'type':
			return {
				kind: 'type',
				settleMs: input.settleMs,
				snapshotId: input.snapshotId,
				nodeRef: input.nodeRef,
				text: input.text,
			};
		case 'upload':
			return {
				kind: 'upload',
				settleMs: input.settleMs,
				snapshotId: input.snapshotId,
				nodeRef: input.nodeRef,
				name: input.name,
				mediaType: input.mediaType,
				bytes: input.bytes.slice(),
			};
		case 'download':
			return { kind: 'download', snapshotId: input.snapshotId, nodeRef: input.nodeRef, maxBytes: input.maxBytes };
	}
}
