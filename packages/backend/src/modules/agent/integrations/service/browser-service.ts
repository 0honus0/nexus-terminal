import { randomUUID } from 'node:crypto';
import { AgentFailure, isAgentDrainFailure, ToolCleanupFailure, ToolExecutionUnknown } from '../../agent-failure.js';
import type { BrowserModel } from '../model/browser-model.js';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { ArtifactActor, ArtifactRecord } from '../../artifacts/model/artifact-types.js';
import type {
	BrowserApplicationSession,
	BrowserActor,
	BrowserTarget,
	BrowserConfiguration,
	BrowserOwner,
	BrowserToolOwner,
	BrowserInput,
	BrowserSessionRecord,
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
	record: BrowserSessionRecord;
	capability: BrowserApplicationSession;
}

export class BrowserService {
	private readonly sessions = new Map<string, ActiveBrowserSession>();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly stop = new AbortController();
	private readonly failures: unknown[] = [];
	private lane: Promise<unknown> = Promise.resolve();
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
	): Promise<{ artifactId: string; version: number; sha256: string; sizeBytes: number; mediaType: string }> {
		const actor = this.actor(owner),
			record = await this.artifacts.begin(actor, { name, mediaType, declaredBytes: bytes.byteLength });

		async function* source(): AsyncIterable<Uint8Array> {
			yield bytes;
		}

		const saved: ArtifactRecord = await this.artifacts.upload(actor, record.id, record.version, source(), signal);
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

	private task<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		if (this.closing || this.pending.size >= 16) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		const deadline = AbortSignal.any([this.stop.signal, AbortSignal.timeout(60000)]);
		const task = this.lane.then(() => {
			if (this.closing || deadline.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			return work(deadline);
		});
		this.lane = task.then(
			() => undefined,
			() => undefined,
		);
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

	configuration(actor: BrowserActor): Promise<BrowserConfiguration> {
		return this.task(() => this.model.configuration(actor.userId));
	}

	update(actor: BrowserActor, version: number, targets: BrowserTarget[]): Promise<BrowserConfiguration> {
		return this.task(async () => {
			const result = await this.model.update(actor, version, targets, (userId) => {
				if (userId !== actor.userId) {
					throw new AgentFailure('unauthenticated');
				}
			});
			const sessions = [...this.sessions.entries()].filter(
				([, session]) => session.owner.userId === actor.userId,
			);
			const released = await Promise.allSettled(
				sessions.map(async ([id, session]) => {
					await session.capability.close();
					this.sessions.delete(id);
				}),
			);
			const failures = released.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
			if (failures.length) {
				throw new ToolCleanupFailure({
					cause: new AggregateError(failures, 'Browser configuration committed but retirement failed'),
				});
			}
			return result;
		});
	}

	perform(
		owner: BrowserToolOwner,
		input: BrowserInput,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<string> {
		return this.task(async (deadline) => {
			const combined = AbortSignal.any([deadline, signal]);
			await validate();
			combined.throwIfAborted();
			if (input.action === 'open') {
				if (this.sessions.size >= 16) {
					throw new AgentFailure('limit_exceeded');
				}
				const config = await this.model.configuration(owner.userId);
				const target = config.targets.find((item) => item.id === input.targetId);
				if (!target) {
					throw new AgentFailure('not_found');
				}
				if (config.version !== input.expectedVersion) {
					throw new AgentFailure('version_conflict');
				}
				const capability = await this.connectTarget(target, combined);
				try {
					const current = await this.model.configuration(owner.userId);
					await validate();
					combined.throwIfAborted();
					if (current.version !== config.version) {
						throw new AgentFailure('version_conflict');
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
						record,
						capability,
					});
					return JSON.stringify({
						sessionId: record.sessionId,
						targetId: record.targetId,
						targetVersion: record.targetVersion,
						runId: record.runId,
						createdAt: record.createdAt,
					});
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
				session.owner.runId !== owner.runId
			) {
				throw new AgentFailure('not_found');
			}
			if (input.action === 'close') {
				await session.capability.close();
				this.sessions.delete(input.sessionId);
				return JSON.stringify({ status: 'closed' });
			}
			if ((await this.model.configuration(owner.userId)).version !== session.record.targetVersion) {
				throw new AgentFailure('version_conflict');
			}
			let result: unknown;
			if (input.action === 'snapshot') {
				result = await session.capability.snapshot(input.maxNodes, combined);
			} else if (input.action === 'screenshot') {
				const bytes = await session.capability.screenshot(
					await this.artifacts.availableBytes(this.actor(owner)),
					combined,
				);
				await validate();
				result = await this.saveCapture(
					owner,
					'screenshot-' + session.record.sessionId + '.png',
					'image/png',
					bytes,
					combined,
				);
			} else if (input.action === 'console') {
				result = session.capability.console(input.after, input.limit);
			} else if (input.action === 'upload') {
				result = await this.artifacts.useToolContent(
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
					result = await this.saveCapture(owner, reply.name, reply.mediaType, reply.bytes, combined);
				} else {
					result = { kind: 'page', url: reply.url, title: reply.title };
				}
			}
			await validate();
			combined.throwIfAborted();
			return JSON.stringify(result);
		});
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
