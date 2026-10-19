import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import type { OperationsEvents } from '../../../operations/public.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import { randomUUID, createHash } from 'node:crypto';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import {
	AGENT_ARTIFACT_MAX_CLEANUP_ITEMS,
	AGENT_ARTIFACT_MAX_BYTES,
	AGENT_ARTIFACT_MAX_PAGE,
} from '@nexus-terminal/shared/agent/artifacts/values';
import { AgentFailure, ToolCleanupFailure, isAgentDrainFailure } from '../../agent-failure.js';
import type { ArtifactModel } from '../model/artifact-model.js';
import type {
	ArtifactActor,
	ArtifactScope,
	ArtifactRecord,
	ArtifactFacts,
	ArtifactBegin,
	ArtifactQuery,
	ArtifactAttachment,
	ArtifactReadRange,
	ArtifactCleanupPlan,
	ArtifactCleanupResult,
	ArtifactStorageTotals,
	ArtifactContent,
} from '../model/artifact-types.js';
const TOTAL_BYTES = 512 * 1024 * 1024;

function identity(actor: ArtifactActor): (value: number | null) => void {
	return (value) => {
		if (value !== actor.userId) {
			throw new AgentFailure(
				actor.kind === 'session' ? (value === null ? 'unauthenticated' : 'forbidden') : 'version_conflict',
			);
		}
	};
}

function admit(
	actor: ArtifactActor,
	bytes = 0,
	creation = false,
	maxBytes = TOTAL_BYTES,
): (facts: ArtifactFacts) => void {
	return (facts) => {
		identity(actor)(facts.identityUserId);
		if (!facts.appExists) {
			throw new AgentFailure('not_found');
		}
		if (!facts.appEnabled) {
			throw new AgentFailure('app_disabled');
		}
		if (creation && (facts.totalCount >= 10000 || facts.totalBytes + bytes > maxBytes)) {
			throw new AgentFailure('limit_exceeded');
		}
	};
}

function id(value: string): void {
	if (!AGENT_ID_PATTERN.test(value)) {
		throw new AgentFailure('invalid_input');
	}
}

function scope(value: ArtifactScope): void {
	if (!Number.isSafeInteger(value.userId) || value.userId < 1) {
		throw new AgentFailure('invalid_input');
	}
	id(value.appId);
}

function version(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new AgentFailure('invalid_input');
	}
}

function ready(row: ArtifactRecord, now: number): void {
	if (row.status !== 'ready' || (!row.retained && row.expiresAt !== null && row.expiresAt <= now)) {
		throw new AgentFailure('version_conflict');
	}
}

function deletable(row: ArtifactRecord, references: number, now: number, expired = false): void {
	if (
		(expired ? row.status !== 'ready' : !['ready', 'staging', 'unavailable', 'deleting'].includes(row.status)) ||
		row.retained ||
		references > 0 ||
		(expired && (row.expiresAt === null || row.expiresAt > now))
	) {
		throw new AgentFailure('version_conflict');
	}
}

function kind(mediaType: string): ArtifactRecord['kind'] {
	if (mediaType.startsWith('image/')) {
		return 'image';
	}
	if (mediaType.startsWith('audio/') || mediaType.startsWith('video/')) {
		return 'media';
	}
	if (['application/zip', 'application/gzip', 'application/x-tar'].includes(mediaType)) {
		return 'archive';
	}
	if (['application/json', 'application/javascript', 'text/javascript', 'text/x-typescript'].includes(mediaType)) {
		return 'code';
	}
	if (mediaType.startsWith('text/') || mediaType === 'application/pdf') {
		return 'document';
	}
	return 'other';
}

export class ArtifactService {
	private readonly failures = new FailureSummary();
	private stopping = false;
	private closePromise: Promise<void> | null = null;
	private readonly mutations = new Set<Promise<unknown>>();
	private readonly activeLeases = new Set<Promise<void>>();

	async initialize(): Promise<void> {
		const values = await this.model.recovery();
		const summary = new FailureSummary();
		for (const value of values) {
			try {
				await this.removeClaimed(value.userId, value.record);
			} catch (error) {
				summary.record(error);
			}
		}
		const failures = summary.errors();
		if (failures.length) {
			throw new AggregateError(failures, 'Artifact recovery incomplete');
		}
	}

	quiesce(): void {
		this.stopping = true;
	}

	close(): Promise<void> {
		if (this.closePromise === null) {
			const admitted = [...this.activeLeases, ...this.mutations];
			this.closePromise = Promise.resolve().then(async () => {
				await Promise.allSettled(admitted);
				if (this.readers.size && !this.failures.errors().length) {
					this.failures.record(new Error('Artifact leases remain active'));
				}
				if (this.failures.errors().length) {
					throw new AggregateError(this.failures.errors(), 'Artifact resources remain unconfirmed');
				}
			});
			this.quiesce();
		}
		return this.closePromise;
	}

	private async ownMutation<T>(work: () => Promise<T>): Promise<T> {
		if (this.stopping) {
			throw new AgentFailure('provider_unavailable');
		}
		const pending = Promise.resolve().then(work);
		this.mutations.add(pending);
		try {
			return await pending;
		} catch (error) {
			if (isAgentDrainFailure(error)) {
				this.failures.record(error);
			}
			throw error;
		} finally {
			this.mutations.delete(pending);
		}
	}

	private readonly readers = new Map<string, number>();

	private acquireRead(id: string): (cleanupFailed?: boolean) => void {
		if (this.stopping) {
			throw new AgentFailure('provider_unavailable');
		}
		this.readers.set(id, (this.readers.get(id) ?? 0) + 1);

		let finish: () => void = () => undefined;

		const active = new Promise<void>((resolve) => {
			finish = resolve;
		});
		this.activeLeases.add(active);
		let finished = false;
		return (cleanupFailed = false) => {
			if (finished) {
				return;
			}
			finished = true;
			this.activeLeases.delete(active);
			finish();
			if (cleanupFailed) {
				return;
			}
			const count = (this.readers.get(id) ?? 1) - 1;
			if (count === 0) {
				this.readers.delete(id);
			} else {
				this.readers.set(id, count);
			}
		};
	}

	private admitDeletion(row: ArtifactRecord, references: number, now: number, expired = false): void {
		if (this.readers.has(row.id)) {
			throw new AgentFailure('version_conflict');
		}
		deletable(row, references, now, expired);
	}

	async readTool(
		actor: ArtifactActor,
		artifactId: string,
		offset: number,
		maxBytes: number,
		signal: AbortSignal,
	): Promise<{
		id: string;
		sha256: string;
		sizeBytes: number;
		offset: number;
		nextOffset: number | null;
		base64: string;
	}> {
		scope(actor);
		id(artifactId);
		if (
			actor.kind !== 'tool' ||
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			!Number.isSafeInteger(maxBytes) ||
			maxBytes < 1 ||
			maxBytes > 4096
		) {
			throw new AgentFailure('invalid_input');
		}
		const release = this.acquireRead(artifactId);
		let cleanupFailed = false;
		try {
			const authorize = () =>
				this.model.getAccessible(actor, artifactId, admit(actor), (value, enabled) => {
					ready(value, Date.now());
					if (!enabled) {
						throw new AgentFailure('app_disabled');
					}
				});

			const row = await authorize();
			signal.throwIfAborted();
			if (offset > row.sizeBytes || row.sha256 === null) {
				throw new AgentFailure('invalid_input');
			}
			const end = Math.min(row.sizeBytes, offset + maxBytes);
			const chunks: Uint8Array[] = [];
			let size = 0;
			if (end > offset) {
				for await (const chunk of this.model.read(row.id, { start: offset, endInclusive: end - 1 }, signal)) {
					size += chunk.byteLength;
					if (size > end - offset) {
						throw new AgentFailure('storage_unavailable');
					}
					chunks.push(chunk);
				}
			}
			const current = await authorize();
			signal.throwIfAborted();
			const bytes = Buffer.concat(chunks, size);
			if (
				current.version !== row.version ||
				current.sha256 !== row.sha256 ||
				current.sizeBytes !== row.sizeBytes
			) {
				throw new AgentFailure('version_conflict');
			}
			if (bytes.byteLength !== end - offset) {
				throw new AgentFailure('storage_unavailable');
			}
			return {
				id: row.id,
				sha256: row.sha256,
				sizeBytes: row.sizeBytes,
				offset,
				nextOffset: end < row.sizeBytes ? end : null,
				base64: bytes.toString('base64'),
			};
		} catch (error) {
			if (error instanceof ToolCleanupFailure) {
				cleanupFailed = true;
				this.failures.record(error);
			}
			throw error;
		} finally {
			release(cleanupFailed);
		}
	}

	async useToolContent<T>(
		actor: ArtifactActor,
		artifactId: string,
		expectedVersion: number,
		sha256: string,
		signal: AbortSignal,
		consume: (content: ArtifactContent) => Promise<T>,
	): Promise<T> {
		scope(actor);
		id(artifactId);
		version(expectedVersion);
		if (actor.kind !== 'tool' || !/^[a-f0-9]{64}$/u.test(sha256)) {
			throw new AgentFailure('invalid_input');
		}
		const release = this.acquireRead(artifactId);
		let cleanupFailed = false;
		try {
			const read = () =>
				this.model.getAccessible(actor, artifactId, admit(actor), (row, enabled) => {
					ready(row, Date.now());
					if (!enabled || row.version !== expectedVersion || row.sha256 !== sha256) {
						throw new AgentFailure('version_conflict');
					}
				});

			const row = await read();
			const chunks: Uint8Array[] = [];
			let size = 0;
			if (row.sizeBytes > AGENT_ARTIFACT_MAX_BYTES) {
				throw new AgentFailure('limit_exceeded');
			}
			if (row.sizeBytes) {
				for await (const chunk of this.model.read(
					row.id,
					{ start: 0, endInclusive: row.sizeBytes - 1 },
					signal,
				)) {
					size += chunk.byteLength;
					if (size > row.sizeBytes) {
						throw new AgentFailure('limit_exceeded');
					}
					chunks.push(chunk);
				}
			}
			const bytes = Buffer.concat(chunks, size);
			if (size !== row.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== sha256) {
				throw new AgentFailure('storage_unavailable');
			}
			await read();
			signal.throwIfAborted();
			return await consume({
				id: row.id,
				version: row.version,
				name: row.name,
				mediaType: row.mediaType,
				sha256,
				bytes,
			});
		} catch (error) {
			if (error instanceof ToolCleanupFailure) {
				cleanupFailed = true;
				this.failures.record(error);
			}
			throw error;
		} finally {
			release(cleanupFailed);
		}
	}

	constructor(
		private readonly model: ArtifactModel,
		private readonly settings: ExecutionService,
		private readonly events: OperationsEvents,
	) {}

	async begin(actor: ArtifactActor, input: ArtifactBegin): Promise<ArtifactRecord> {
		scope(actor);
		if (
			!input.name.trim() ||
			Buffer.byteLength(input.name, 'utf8') > 256 ||
			/[\u0000-\u001f\u007f/\\]/u.test(input.name) ||
			Buffer.from(input.name, 'utf8').toString('utf8') !== input.name ||
			!Number.isSafeInteger(input.declaredBytes) ||
			input.declaredBytes < 0 ||
			input.declaredBytes > AGENT_ARTIFACT_MAX_BYTES ||
			Buffer.byteLength(input.mediaType, 'utf8') > 128 ||
			!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(input.mediaType)
		) {
			throw new AgentFailure('invalid_input');
		}
		if ((await this.model.freeBytes()) < input.declaredBytes + 64 * 1024 * 1024) {
			throw new AgentFailure('limit_exceeded');
		}
		const configuration =
			actor.kind === 'session'
				? await this.settings.get(actor.userId)
				: await this.settings.frozen(actor.userId, actor.appId, actor.runId);
		if (input.declaredBytes > configuration.limits.maxSingleArtifactBytes) {
			throw new AgentFailure('limit_exceeded');
		}
		const now = Date.now();
		return this.model.create(
			actor,
			randomUUID(),
			{ name: input.name, mediaType: input.mediaType, declaredBytes: input.declaredBytes },
			kind(input.mediaType),
			now + configuration.limits.artifactTtlSeconds * 1000,
			now,
			(facts) => {
				if (facts.settingsVersion !== configuration.version) {
					throw new AgentFailure('version_conflict');
				}
				admit(actor, input.declaredBytes, true, configuration.limits.maxArtifactBytes)(facts);
			},
		);
	}

	get(owner: ArtifactScope, artifactId: string): Promise<ArtifactRecord | null> {
		scope(owner);
		id(artifactId);
		return this.model.get(owner, artifactId);
	}

	async upload(
		actor: ArtifactActor,
		artifactId: string,
		expectedVersion: number,
		source: AsyncIterable<Uint8Array>,
		signal: AbortSignal,
	): Promise<ArtifactRecord> {
		const release = this.acquireRead(artifactId);
		let cleanupFailed = false;
		try {
			return await this.uploadOwned(actor, artifactId, expectedVersion, source, signal);
		} catch (error) {
			if (error instanceof ToolCleanupFailure) {
				cleanupFailed = true;
				this.failures.record(error);
			}
			throw error;
		} finally {
			release(cleanupFailed);
		}
	}

	private async uploadOwned(
		actor: ArtifactActor,
		artifactId: string,
		expectedVersion: number,
		source: AsyncIterable<Uint8Array>,
		signal: AbortSignal,
	): Promise<ArtifactRecord> {
		scope(actor);
		id(artifactId);
		version(expectedVersion);
		signal.throwIfAborted();
		const claimed = await this.model.mutate(
			actor,
			artifactId,
			expectedVersion,
			Date.now,
			'upload',
			null,
			admit(actor),
			(row, _references, now) => {
				if (row.status !== 'staging' || row.expiresAt === null || row.expiresAt <= now) {
					throw new AgentFailure('version_conflict');
				}
			},
		);
		let written;
		try {
			written = await this.model.write(artifactId, source, claimed.sizeBytes, signal);
		} catch (error) {
			// Keep the reservation until an explicit recovery checks filesystem evidence.
			// Unknown database commits never trigger another speculative settlement.
			if (error instanceof AgentFailure && error.code === 'operation_unknown') {
				throw error;
			}
			try {
				await this.model.settle(actor, artifactId, claimed.version, 'unavailable', null, Date.now());
			} catch (settlement) {
				throw new AgentFailure('operation_unknown', {
					cause: new AggregateError([error, settlement], 'Artifact upload and settlement failed'),
				});
			}
			throw error;
		}
		// Publication may already exist. Any failure from here is an unknown composite write.
		try {
			const value = await this.model.settle(
				actor,
				artifactId,
				claimed.version,
				'ready',
				written.sha256,
				Date.now(),
			);
			await this.events.publish({
				key: 'artifact:' + value.id + ':' + value.version,
				event: 'AGENT_ARTIFACT_CREATED',
				userId: actor.userId,
				subjectId: value.id,
				sourceIp: null,
				route: null,
				statusCode: null,
			});
			return value;
		} catch (error) {
			throw new AgentFailure('operation_unknown', { cause: error });
		}
	}

	async list(userId: number, query: ArtifactQuery): Promise<{ items: ArtifactRecord[]; nextOffset: number | null }> {
		if (
			!Number.isSafeInteger(userId) ||
			userId < 1 ||
			!Number.isSafeInteger(query.limit) ||
			query.limit < 1 ||
			query.limit > AGENT_ARTIFACT_MAX_PAGE ||
			!Number.isSafeInteger(query.offset) ||
			query.offset < 0 ||
			query.offset > 10000 ||
			Buffer.byteLength(query.q, 'utf8') > 256
		) {
			throw new AgentFailure('invalid_input');
		}
		if (query.appId !== null) {
			id(query.appId);
		}
		const items = await this.model.list(userId, {
			appId: query.appId,
			retained: query.retained,
			kind: query.kind,
			q: query.q,
			offset: query.offset,
			limit: query.limit + 1,
		});
		return {
			items: items.slice(0, query.limit),
			nextOffset: items.length > query.limit ? query.offset + query.limit : null,
		};
	}

	async summary(userId: number): Promise<ArtifactStorageTotals> {
		if (!Number.isSafeInteger(userId) || userId < 1) {
			throw new AgentFailure('invalid_input');
		}
		const configuration = await this.settings.get(userId);
		return this.model.summary(userId, Date.now(), configuration.limits.maxArtifactBytes);
	}

	async retain(
		actor: ArtifactActor,
		artifactId: string,
		expectedVersion: number,
		retained: boolean,
	): Promise<ArtifactRecord> {
		scope(actor);
		id(artifactId);
		version(expectedVersion);
		if (actor.kind !== 'session') {
			throw new AgentFailure('invalid_input');
		}
		return this.model.mutate(
			actor,
			artifactId,
			expectedVersion,
			Date.now,
			'retain',
			retained,
			admit(actor),
			(row, _references, now) => ready(row, now),
		);
	}

	delete(actor: ArtifactActor, artifactId: string, expectedVersion: number): Promise<void> {
		return this.ownMutation(() => this.deleteOwned(actor, artifactId, expectedVersion));
	}

	private async deleteOwned(actor: ArtifactActor, artifactId: string, expectedVersion: number): Promise<void> {
		scope(actor);
		id(artifactId);
		version(expectedVersion);
		if (actor.kind !== 'session') {
			throw new AgentFailure('invalid_input');
		}
		const claimed = await this.model.mutate(
			actor,
			artifactId,
			expectedVersion,
			Date.now,
			'delete',
			null,
			(facts) => {
				identity(actor)(facts.identityUserId);
				if (!facts.appExists) {
					throw new AgentFailure('not_found');
				}
			},
			(row, references, now) => this.admitDeletion(row, references, now),
		);
		await this.removeClaimed(actor.userId, claimed);
	}

	private async removeClaimed(userId: number, row: ArtifactRecord): Promise<void> {
		try {
			await this.model.remove(row.id);
			await this.model.settle(
				{ userId, appId: row.appId },
				row.id,
				row.version,
				'deleted',
				row.sha256,
				Date.now(),
			);
			await this.events.publish({
				key: 'artifact:deleted:' + row.id,
				event: 'AGENT_ARTIFACT_DELETED',
				userId,
				subjectId: row.id,
				sourceIp: null,
				route: null,
				statusCode: null,
			});
		} catch (error) {
			throw new AgentFailure('operation_unknown', { cause: error });
		}
	}

	async attach(actor: ArtifactActor, artifactId: string, input: ArtifactAttachment): Promise<ArtifactRecord> {
		scope(actor);
		id(artifactId);
		id(input.targetAppId);
		id(input.threadId);
		version(input.expectedVersion);
		if (input.runId !== null) {
			id(input.runId);
		}
		if (actor.kind !== 'session') {
			throw new AgentFailure('invalid_input');
		}
		return this.model.attach(
			actor,
			artifactId,
			{
				expectedVersion: input.expectedVersion,
				targetAppId: input.targetAppId,
				threadId: input.threadId,
				runId: input.runId,
			},
			Date.now,
			admit(actor),
			(row, enabled, now) => {
				ready(row, now);
				if (!enabled) {
					throw new AgentFailure('app_disabled');
				}
			},
		);
	}

	detach(
		actor: ArtifactActor,
		artifactId: string,
		expectedVersion: number,
		threadId: string,
	): Promise<ArtifactRecord> {
		scope(actor);
		id(artifactId);
		id(threadId);
		version(expectedVersion);
		if (actor.kind !== 'session') {
			throw new AgentFailure('invalid_input');
		}
		return this.model.detach(actor, artifactId, expectedVersion, threadId, Date.now(), admit(actor));
	}

	previewCleanup(actor: ArtifactActor): Promise<ArtifactCleanupPlan> {
		scope(actor);
		if (actor.kind !== 'session') {
			throw new AgentFailure('invalid_input');
		}
		return this.model.previewCleanup(
			actor,
			randomUUID(),
			600000,
			Date.now,
			(value, confirmations) => {
				identity(actor)(value);
				if (confirmations >= 128) {
					throw new AgentFailure('limit_exceeded');
				}
			},
			AGENT_ARTIFACT_MAX_CLEANUP_ITEMS,
		);
	}

	confirmCleanup(actor: ArtifactActor, confirmationId: string): Promise<ArtifactCleanupResult> {
		return this.ownMutation(() => this.confirmCleanupOwned(actor, confirmationId));
	}

	private async confirmCleanupOwned(actor: ArtifactActor, confirmationId: string): Promise<ArtifactCleanupResult> {
		scope(actor);
		id(confirmationId);
		if (actor.kind !== 'session') {
			throw new AgentFailure('invalid_input');
		}
		const claimed = await this.model.claimCleanup(
			actor,
			confirmationId,
			Date.now,
			identity(actor),
			(row, references, now) => this.admitDeletion(row, references, now, true),
		);
		let deletedCount = 0;
		let deletedBytes = 0;
		let failedCount = 0;
		for (const row of claimed) {
			try {
				await this.removeClaimed(actor.userId, row);
				deletedCount++;
				deletedBytes += row.sizeBytes;
			} catch (error) {
				if (!(error instanceof AgentFailure)) {
					throw error;
				}
				this.failures.record(error);
				failedCount++;
			}
		}
		return { deletedCount, deletedBytes, failedCount, skippedCount: 0, partial: failedCount > 0 };
	}

	/** The grant owner rechecks current authority; this owner retains the actual read lease. */
	async *readGranted(
		artifactId: string,
		range: ArtifactReadRange,
		signal: AbortSignal,
		authorize: () => Promise<ArtifactRecord>,
	): AsyncIterable<Uint8Array> {
		id(artifactId);
		const release = this.acquireRead(artifactId);
		let cleanupFailed = false;
		try {
			const value = await authorize();
			signal.throwIfAborted();
			ready(value, Date.now());
			if (
				value.id !== artifactId ||
				!Number.isSafeInteger(range.start) ||
				range.start < 0 ||
				!Number.isSafeInteger(range.endInclusive) ||
				(range.endInclusive < range.start &&
					!(value.sizeBytes === 0 && range.start === 0 && range.endInclusive === -1)) ||
				range.endInclusive >= value.sizeBytes
			) {
				throw new AgentFailure('invalid_input');
			}
			let size = 0;
			const expectedBytes = range.endInclusive - range.start + 1;
			const content =
				expectedBytes === 0
					? []
					: this.model.read(artifactId, { start: range.start, endInclusive: range.endInclusive }, signal);
			for await (const chunk of content) {
				size += chunk.byteLength;
				if (size > expectedBytes) {
					throw new AgentFailure('storage_unavailable');
				}
				signal.throwIfAborted();
				const current = await authorize();
				signal.throwIfAborted();
				ready(current, Date.now());
				if (
					current.id !== value.id ||
					current.version !== value.version ||
					current.sha256 !== value.sha256 ||
					current.sizeBytes !== value.sizeBytes
				) {
					throw new AgentFailure('version_conflict');
				}
				yield chunk;
			}
			const current = await authorize();
			signal.throwIfAborted();
			ready(current, Date.now());
			if (
				current.id !== value.id ||
				current.version !== value.version ||
				current.sha256 !== value.sha256 ||
				current.sizeBytes !== value.sizeBytes
			) {
				throw new AgentFailure('version_conflict');
			}
			if (size !== expectedBytes) {
				throw new AgentFailure('storage_unavailable');
			}
		} catch (error) {
			if (error instanceof ToolCleanupFailure) {
				cleanupFailed = true;
				this.failures.record(error);
			}
			throw error;
		} finally {
			release(cleanupFailed);
		}
	}

	read(
		actor: ArtifactActor,
		artifactId: string,
		expectedVersion: number,
		range: ArtifactReadRange,
		signal: AbortSignal,
	): AsyncIterable<Uint8Array> {
		scope(actor);
		id(artifactId);
		version(expectedVersion);
		return this.readGranted(artifactId, { start: range.start, endInclusive: range.endInclusive }, signal, () =>
			this.model.getAccessible(
				actor,
				artifactId,
				(facts) => {
					identity(actor)(facts.identityUserId);
					if (!facts.appExists) {
						throw new AgentFailure('not_found');
					}
					if (actor.kind === 'tool' && !facts.appEnabled) {
						throw new AgentFailure('app_disabled');
					}
				},
				(row, enabled) => {
					ready(row, Date.now());
					if (actor.kind === 'tool' && !enabled) {
						throw new AgentFailure('app_disabled');
					}
					if (row.version !== expectedVersion) {
						throw new AgentFailure('version_conflict');
					}
				},
			),
		);
	}
}
