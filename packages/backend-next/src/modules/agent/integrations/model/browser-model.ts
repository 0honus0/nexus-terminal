import type { BrowserClient, BrowserSession } from '../../../../platform/browser/browser-client.js';
import { BrowserFailure } from '../../../../platform/browser/browser-client.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { AgentFailure, ToolCleanupFailure, ToolExecutionUnknown } from '../../agent-failure.js';
import { agentStorage } from '../../agent-storage-failure.js';
import type { BrowserStorage, StoredBrowserTarget, StoredBrowserConfiguration } from '../storage/browser-storage.js';
import { BrowserStorageRefusal } from '../storage/browser-storage.js';
import type {
	BrowserActor,
	BrowserTarget,
	BrowserConfiguration,
	BrowserSnapshot,
	BrowserSessionAction,
	BrowserReply,
	BrowserApplicationSession,
} from './browser-types.js';

function toStored(value: BrowserTarget): StoredBrowserTarget {
	return {
		id: value.id,
		endpoints: value.endpoints.map((endpoint) => ({
			url: endpoint.url,
			priority: endpoint.priority,
			allowPlaintext: endpoint.allowPlaintext,
			verifyTls: endpoint.verifyTls,
		})),
		allowedUrlPatterns: value.allowedUrlPatterns.map((pattern) => pattern),
	};
}

function fromStored(value: StoredBrowserConfiguration): BrowserConfiguration {
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

function failure(error: unknown, mutation = false): never {
	if (error instanceof BrowserFailure) {
		if (error.kind === 'cleanup_failed') {
			throw new ToolCleanupFailure({ cause: error });
		}
		if (error.kind === 'stale_snapshot') {
			throw new AgentFailure('version_conflict', { cause: error });
		}
		if (error.kind === 'limit_exceeded') {
			throw new AgentFailure('limit_exceeded', { cause: error });
		}
		if (error.kind === 'url_denied') {
			throw new AgentFailure('target_denied', { cause: error });
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

	async snapshot(maxNodes: number, signal: AbortSignal): Promise<BrowserSnapshot> {
		try {
			const value = await this.session.snapshot(maxNodes, signal);
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
	constructor(
		private readonly storage: BrowserStorage,
		private readonly tokens: SessionTokens,
		private readonly client: BrowserClient,
	) {}

	async configuration(userId: number): Promise<BrowserConfiguration> {
		return fromStored(await agentStorage(() => this.storage.get(userId)));
	}

	async update(
		actor: BrowserActor,
		version: number,
		targets: BrowserTarget[],
		admit: (userId: number | null) => void,
	): Promise<BrowserConfiguration> {
		return fromStored(
			await agentStorage(async () => {
				try {
					return await this.storage.update(
						actor.userId,
						this.tokens.digest(actor.token),
						version,
						targets.map(toStored),
						admit,
					);
				} catch (error) {
					if (error instanceof BrowserStorageRefusal) {
						throw new AgentFailure(error.code, { cause: error });
					}
					throw error;
				}
			}),
		);
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
