import { randomUUID } from 'node:crypto';
import {
	AgentFailure,
	isAgentDrainFailure,
	ToolCleanupFailure,
	ToolExecutionUnknown,
	ToolOperationRefusal,
} from '../../agent-failure.js';
import type { BrowserModel } from '../model/browser-model.js';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { ArtifactActor, ArtifactRecord } from '../../artifacts/model/artifact-types.js';
import type {
	BrowserApplicationSession,
	BrowserConfigurationSource,
	BrowserTarget,
	BrowserOwner,
	BrowserToolOwner,
	BrowserInput,
	BrowserSessionRecord,
	BrowserCatalog,
	BrowserCapture,
	BrowserOperationResult,
} from '../model/browser-types.js';

function allowUrl(target: BrowserTarget, url: string): boolean {
	if (url === 'about:blank') {
		return true;
	}
	let candidate: URL;
	try {
		candidate = new URL(url);
	} catch {
		return false;
	}
	if (candidate.username || candidate.password || !['http:', 'https:'].includes(candidate.protocol)) {
		return false;
	}
	return target.allowedUrlPatterns.some((pattern) => {
		const parsed = new URL(pattern);
		if (candidate.origin !== parsed.origin) {
			return false;
		}
		return parsed.pathname.endsWith('*')
			? candidate.pathname.startsWith(parsed.pathname.slice(0, -1))
			: candidate.pathname === parsed.pathname;
	});
}

interface ActiveBrowserSession {
	owner: BrowserOwner;
	instanceId: string;
	generation: string;
	record: BrowserSessionRecord;
	capability: BrowserApplicationSession;
}

export class BrowserService {
	private readonly sessions = new Map<string, ActiveBrowserSession>();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly stop = new AbortController();
	private readonly failures: unknown[] = [];
	private readonly barriers = new Map<string, Promise<unknown>>();
	private readonly lanes = new Map<string, { group: string; settled: Promise<unknown> }>();
	private closing = false;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly model: BrowserModel,
		private readonly artifacts: ArtifactService,
	) {}

	private actor(owner: BrowserToolOwner): ArtifactActor {
		return {
			kind: 'tool',
			userId: owner.userId,
			appId: owner.appId,
			runId: owner.runId,
			operationId: owner.operationId,
			operationHash: owner.operationHash,
		};
	}

	private async saveCapture(
		owner: BrowserToolOwner,
		name: string,
		mediaType: string,
		bytes: Uint8Array,
		signal: AbortSignal,
		recordOutputArtifacts: (ids: readonly string[]) => void,
	): Promise<BrowserCapture> {
		signal.throwIfAborted();
		const actor = this.actor(owner),
			record = await this.artifacts.begin(actor, { name, mediaType, declaredBytes: bytes.byteLength });

		async function* source(): AsyncIterable<Uint8Array> {
			yield bytes;
		}

		const saved: ArtifactRecord = await this.artifacts.upload(
			actor,
			record.id,
			record.version,
			source(),
			signal,
			recordOutputArtifacts,
		);
		if (saved.status !== 'ready' || saved.sha256 === null) {
			throw new AgentFailure('operation_unknown');
		}
		return {
			artifactId: saved.id,
			version: saved.version,
			sha256: saved.sha256,
			sizeBytes: saved.sizeBytes,
			mediaType: saved.mediaType,
		};
	}

	private async connectTarget(target: BrowserTarget, signal: AbortSignal): Promise<BrowserApplicationSession> {
		const failures: unknown[] = [];
		for (const endpoint of [...target.endpoints].sort((first, second) => first.priority - second.priority)) {
			signal.throwIfAborted();
			try {
				return await this.model.connect(
					{ url: endpoint.url, verifyTls: endpoint.verifyTls },
					(url) => allowUrl(target, url),
					signal,
				);
			} catch (error) {
				if (!(error instanceof AgentFailure) || error.code !== 'provider_unavailable') {
					throw error;
				}
				failures.push(error);
			}
		}
		throw new AgentFailure('provider_unavailable', {
			cause: new AggregateError(failures, 'Browser endpoints unavailable'),
		});
	}

	private task<T>(
		source: { instanceId: string; generation: string },
		work: (signal: AbortSignal) => Promise<T>,
		signal?: AbortSignal,
		lane?: string,
	): Promise<T> {
		if (this.closing) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		// Tool calls inherit the configured Run/tool signal, including time spent queued.
		const deadline = signal ? AbortSignal.any([this.stop.signal, signal]) : this.stop.signal;
		const group = JSON.stringify([source.instanceId, source.generation]);
		const laneKey = lane ? JSON.stringify([group, lane]) : null;
		const previous = laneKey
			? [this.barriers.get(group), this.lanes.get(laneKey)?.settled]
			: [
					this.barriers.get(group),
					...[...this.lanes.values()].filter((item) => item.group === group).map((item) => item.settled),
				];
		const task = Promise.all(previous).then(async () => {
			if (this.closing || deadline.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			try {
				return await work(deadline);
			} catch (error) {
				// Only the exact cancellation rejection is a stopped wait; independent failures still fence this owner.
				if (deadline.aborted && error === deadline.reason && !(error instanceof AgentFailure)) {
					throw new AgentFailure('provider_unavailable', { cause: error });
				}
				throw error;
			}
		});
		const settled = task.then(
			() => undefined,
			() => undefined,
		);
		if (laneKey) {
			this.lanes.set(laneKey, { group, settled });
			void settled.then(() => {
				if (this.lanes.get(laneKey)?.settled === settled) {
					this.lanes.delete(laneKey);
				}
			});
		} else {
			this.barriers.set(group, settled);
			void settled.then(() => {
				if (this.barriers.get(group) === settled) {
					this.barriers.delete(group);
				}
			});
		}
		this.pending.add(task);
		void task.then(
			() => this.pending.delete(task),
			(error) => {
				this.pending.delete(task);
				if (
					isAgentDrainFailure(error) &&
					(!(error instanceof ToolExecutionUnknown) || error instanceof ToolCleanupFailure)
				) {
					this.failures.push(error);
					this.quiesce();
				}
			},
		);
		return task;
	}

	catalog(
		source: BrowserConfigurationSource,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<BrowserCatalog> {
		return this.task(
			source,
			async (deadline) => {
				const combined = AbortSignal.any([deadline, signal]);
				await validate();
				combined.throwIfAborted();
				const configuration = await this.model.configuration(source);
				await validate();
				combined.throwIfAborted();
				return {
					targets: configuration.targets.map((target) => ({
						targetId: target.id,
						expectedVersion: configuration.version,
						allowedUrlPatterns: target.allowedUrlPatterns.map((pattern) => pattern),
					})),
				};
			},
			signal,
		);
	}

	perform(
		owner: BrowserToolOwner,
		source: BrowserConfigurationSource,
		input: BrowserInput,
		signal: AbortSignal,
		validate: () => Promise<void>,
		recordOutputArtifacts: (ids: readonly string[]) => void,
	): Promise<BrowserOperationResult> {
		return this.task(
			source,
			async (deadline): Promise<BrowserOperationResult> => {
				const combined = AbortSignal.any([deadline, signal]);
				await validate();
				combined.throwIfAborted();
				if (input.action === 'open') {
					const config = await this.model.configuration(source);
					const target = config.targets.find((item) => item.id === input.targetId);
					if (!target) {
						throw new ToolOperationRefusal('not_found');
					}
					if (config.version !== input.expectedVersion) {
						throw new ToolOperationRefusal('version_conflict');
					}
					const capability = await this.connectTarget(target, combined);
					try {
						const current = await this.model.configuration(source);
						await validate();
						combined.throwIfAborted();
						if (current.version !== config.version) {
							throw new ToolOperationRefusal('version_conflict');
						}
						const record = {
							sessionId: randomUUID(),
							targetId: target.id,
							targetVersion: config.version,
							runId: owner.runId,
							createdAt: Date.now(),
						};
						this.sessions.set(record.sessionId, {
							owner: { userId: owner.userId, appId: owner.appId, runId: owner.runId },
							instanceId: source.instanceId,
							generation: source.generation,
							record,
							capability,
						});
						return {
							action: 'open',
							value: {
								sessionId: record.sessionId,
								targetId: record.targetId,
								targetVersion: record.targetVersion,
								runId: record.runId,
								createdAt: record.createdAt,
							},
						};
					} catch (error) {
						try {
							await capability.close();
						} catch (cleanup) {
							throw new ToolCleanupFailure({
								cause: new AggregateError([error, cleanup], 'Browser admission and release failed'),
							});
						}
						throw error;
					}
				}
				const session = this.sessions.get(input.sessionId);
				if (
					!session ||
					session.owner.userId !== owner.userId ||
					session.owner.appId !== owner.appId ||
					session.owner.runId !== owner.runId ||
					session.instanceId !== source.instanceId ||
					session.generation !== source.generation
				) {
					throw new ToolOperationRefusal('not_found');
				}
				if (input.action === 'close') {
					await session.capability.close();
					this.sessions.delete(input.sessionId);
					return { action: 'close', value: { status: 'closed' } };
				}
				if ((await this.model.configuration(source)).version !== session.record.targetVersion) {
					throw new ToolOperationRefusal('version_conflict');
				}
				let result: BrowserOperationResult;
				if (input.action === 'snapshot') {
					const snapshot = await session.capability.snapshot(input.maxNodes, combined);
					result = {
						action: 'snapshot',
						value: {
							snapshotId: snapshot.snapshotId,
							url: snapshot.url,
							title: snapshot.title,
							nodes: snapshot.nodes.map((node) => ({
								ref: node.ref,
								parentRef: node.parentRef,
								tag: node.tag,
								text: node.text,
								attributes: node.attributes.map((attr) => ({ name: attr.name, value: attr.value })),
							})),
							truncated: snapshot.truncated,
						},
					};
				} else if (input.action === 'screenshot') {
					const bytes = await session.capability.screenshot(
						await this.artifacts.availableBytes(this.actor(owner)),
						combined,
					);
					await validate();
					const capture = await this.saveCapture(
						owner,
						'screenshot-' + session.record.sessionId + '.png',
						'image/png',
						bytes,
						combined,
						recordOutputArtifacts,
					);
					result = { action: 'screenshot', value: capture };
				} else if (input.action === 'console') {
					const page = session.capability.console(input.after, input.limit);
					result = {
						action: 'console',
						value: {
							entries: page.entries.map((entry) => ({
								sequence: entry.sequence,
								type: entry.type,
								text: entry.text,
							})),
							nextCursor: page.nextCursor,
							truncated: page.truncated,
						},
					};
				} else if (input.action === 'upload') {
					const reply = await this.artifacts.useToolContent(
						this.actor(owner),
						input.artifactId,
						input.expectedVersion,
						input.sha256,
						session.capability.maxUploadBytes,
						combined,
						async (content) => {
							await validate();
							return session.capability.perform(
								{
									action: 'upload',
									settleMs: input.settleMs,
									sessionId: input.sessionId,
									snapshotId: input.snapshotId,
									nodeRef: input.nodeRef,
									name: content.name,
									mediaType: content.mediaType,
									bytes: content.bytes,
								},
								combined,
							);
						},
					);
					if (reply.kind !== 'page') {
						throw new ToolExecutionUnknown();
					}
					result = { action: 'upload', value: { kind: 'page', url: reply.url, title: reply.title } };
				} else {
					const reply = await session.capability.perform(
						input.action === 'download'
							? {
									action: 'download',
									sessionId: input.sessionId,
									snapshotId: input.snapshotId,
									nodeRef: input.nodeRef,
									maxBytes: Math.min(
										input.maxBytes,
										await this.artifacts.availableBytes(this.actor(owner)),
									),
								}
							: input,
						combined,
					);
					if (reply.kind === 'file') {
						await validate();
						if (input.action !== 'download') {
							throw new ToolExecutionUnknown();
						}
						const capture = await this.saveCapture(
							owner,
							reply.name,
							reply.mediaType,
							reply.bytes,
							combined,
							recordOutputArtifacts,
						);
						result = { action: 'download', value: capture };
					} else {
						if (input.action === 'download') {
							throw new ToolExecutionUnknown();
						}
						result = { action: input.action, value: { kind: 'page', url: reply.url, title: reply.title } };
					}
				}
				await validate();
				combined.throwIfAborted();
				return result;
			},
			signal,
			input.action === 'open' ? 'open:' + owner.operationId : 'session:' + input.sessionId,
		);
	}

	sessionCount(owner: BrowserOwner): number {
		return [...this.sessions.values()].filter(
			(session) =>
				session.owner.userId === owner.userId &&
				session.owner.appId === owner.appId &&
				session.owner.runId === owner.runId,
		).length;
	}

	async drainRun(owner: BrowserOwner): Promise<void> {
		// Run has finished dispatching tools; clear this exact owner's capabilities without a new policy grant.
		const selected = [...this.sessions.entries()].filter(
			([, session]) =>
				session.owner.userId === owner.userId &&
				session.owner.appId === owner.appId &&
				session.owner.runId === owner.runId,
		);
		const results = await Promise.allSettled(
			selected.map(async ([id, session]) => {
				await session.capability.close();
				this.sessions.delete(id);
			}),
		);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			throw new ToolCleanupFailure({ cause: new AggregateError(failures, 'Run browser release failed') });
		}
	}

	retireInstance(scope: { userId: number; appId: string; instanceId: string; generation: string }): Promise<void> {
		if (this.closing) {
			return this.close();
		}
		return this.task(scope, async () => {
			const sessions = [...this.sessions.entries()].filter(
				([, session]) =>
					session.owner.userId === scope.userId &&
					session.owner.appId === scope.appId &&
					session.instanceId === scope.instanceId &&
					session.generation === scope.generation,
			);
			const results = await Promise.allSettled(
				sessions.map(async ([id, session]) => {
					await session.capability.close();
					this.sessions.delete(id);
				}),
			);
			const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
			if (failures.length) {
				throw new ToolCleanupFailure({ cause: new AggregateError(failures, 'Plugin browser release failed') });
			}
		});
	}

	quiesce(): void {
		this.closing = true;
		this.stop.abort();
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closePromise = Promise.resolve().then(async () => {
			await Promise.allSettled([...this.pending]);
			const released = await Promise.allSettled(
				[...this.sessions.values()].map((session) => Promise.resolve().then(() => session.capability.close())),
			);
			const failures = this.failures.concat(
				released.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
			);
			if (failures.length) {
				throw new AggregateError(failures, 'Browser owner release failed');
			}
			this.sessions.clear();
		});
		this.quiesce();
		return this.closePromise;
	}
}
