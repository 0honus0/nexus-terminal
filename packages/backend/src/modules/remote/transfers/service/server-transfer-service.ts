import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic, withDiagnosticContext } from '../../../../platform/logging/diagnostic-log.js';
import { randomUUID } from 'node:crypto';
import type { AccessPublicApi } from '../../../access/public.js';
import type { ServerTransferModel } from '../model/server-transfer-model.js';
import type { ServerTransferCommand, ServerTransferTask, ServerTransferPlan } from '../model/server-transfer-types.js';
import { ServerTransferFailure } from '../model/server-transfer-types.js';
import type { MachineMutationService } from '../../machines/service/mutation-service.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { SERVER_TRANSFER_PAGE_SIZE } from '@nexus-terminal/shared/remote/transfers/server-values';

interface TaskOwner {
	task: ServerTransferTask;
	userId: number;
	digest: string;
	plan: ServerTransferPlan;
	controller: AbortController;
	deadline: number;
	timer: ReturnType<typeof setTimeout>;
	job: Promise<void> | null;
	running: boolean;
	failure: unknown;
}

const MAX_HISTORY = 100;
const MAX_CONCURRENT = 5;
const TASK_DEADLINE_MS = 60 * 60 * 1000;

function final(task: ServerTransferTask): boolean {
	return ['completed', 'failed', 'partially-completed', 'cancelled'].includes(task.status);
}

function settledStatus(task: ServerTransferTask): ServerTransferTask['status'] {
	if (task.subTasks.some((item) => item.status === 'unknown')) {
		return 'unknown';
	}
	if (task.subTasks.every((item) => item.status === 'completed')) {
		return 'completed';
	}
	if (task.subTasks.some((item) => item.status === 'completed')) {
		return 'partially-completed';
	}
	return task.subTasks.some((item) => item.status === 'failed') ? 'failed' : 'cancelled';
}

function toCommand(input: ServerTransferCommand): ServerTransferCommand {
	return {
		sourceConnectionId: input.sourceConnectionId,
		connectionIds: input.connectionIds.map((id) => id),
		sourceItems: input.sourceItems.map((item) => ({ name: item.name, path: item.path, type: item.type })),
		remoteTargetPath: input.remoteTargetPath,
		transferMethod: input.transferMethod,
	};
}

function snapshot(task: ServerTransferTask): ServerTransferTask {
	return {
		taskId: task.taskId,
		status: task.status,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		overallProgress: task.overallProgress,
		payload: toCommand(task.payload),
		subTasks: task.subTasks.map((item) => ({
			subTaskId: item.subTaskId,
			connectionId: item.connectionId,
			sourceItemIndex: item.sourceItemIndex,
			status: item.status,
			progress: item.progress,
			error: item.error,
			transferMethodUsed: item.transferMethodUsed,
		})),
	};
}

function classify(cause: unknown): ServerTransferFailure {
	if (cause instanceof ServerTransferFailure) {
		return cause;
	}
	if (cause instanceof RemoteFileFailure) {
		const code = cause.code;
		if (
			code === 'conflict' ||
			code === 'limit_exceeded' ||
			code === 'stale_target' ||
			code === 'not_found' ||
			code === 'unauthenticated' ||
			code === 'forbidden'
		) {
			return new ServerTransferFailure(code, 'not_started', { cause });
		}
		return new ServerTransferFailure(code === 'operation_unknown' ? code : 'storage_unavailable', 'unknown', {
			cause,
		});
	}
	return new ServerTransferFailure(
		cause instanceof RemoteResourceCleanupFailure ? 'cleanup_failed' : 'operation_unknown',
		'unknown',
		{ cause },
	);
}

/** Application task and authority owner. Source/target transports remain inside Model. */
export class ServerTransferService {
	private readonly records = new Map<string, TaskOwner>();
	private readonly preparing = new Map<AbortController, Promise<ServerTransferTask>>();
	private stopping = false;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly access: AccessPublicApi,
		private readonly model: ServerTransferModel,
		private readonly mutations: MachineMutationService,
		private readonly logger?: Logger,
	) {}

	getActiveTransferCount(): number {
		return (
			this.preparing.size +
			[...this.records.values()].filter((owner) => !final(owner.task) || owner.running).length
		);
	}

	getRetainedTransferCount(): number {
		return this.records.size;
	}

	async send(
		token: string | null,
		read: () => Promise<ServerTransferCommand>,
		signal: AbortSignal,
	): Promise<ServerTransferTask> {
		const identity = await this.identity(token);
		if (this.stopping) {
			throw new ServerTransferFailure('shutting_down');
		}
		this.prune();
		const controller = new AbortController();
		const inputSignal = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(60_000)]);
		const pending = Promise.resolve().then(async () => {
			const command = toCommand(await read());
			inputSignal.throwIfAborted();
			const plan = await this.model.prepare(command);
			if (plan.targets.some((target) => !target.direct)) {
				throw new ServerTransferFailure('unsupported_target_route');
			}
			if (new Set(plan.resources).size !== plan.resources.length) {
				throw new ServerTransferFailure('invalid_input');
			}
			if (
				plan.sourcePin.fingerprint === null ||
				plan.targets.some((target) => target.hostKeyFingerprint === null)
			) {
				throw new ServerTransferFailure('host_key_untrusted');
			}
			const current = await this.identity(token);
			inputSignal.throwIfAborted();
			if (this.stopping || current.userId !== identity.userId || token === null) {
				throw new ServerTransferFailure('shutting_down');
			}
			const now = Date.now();
			const task: ServerTransferTask = {
				taskId: randomUUID(),
				status: 'queued',
				createdAt: now,
				updatedAt: now,
				overallProgress: 0,
				payload: command,
				subTasks: command.connectionIds.flatMap((id) =>
					command.sourceItems.map((_, index) => ({
						subTaskId: randomUUID(),
						connectionId: id,
						sourceItemIndex: index,
						status: 'queued',
						progress: 0,
						error: null,
						transferMethodUsed: null,
					})),
				),
			};
			const owner: TaskOwner = {
				task,
				userId: identity.userId,
				digest: this.model.digest(token),
				plan,
				controller: new AbortController(),
				deadline: now + TASK_DEADLINE_MS,
				timer: setTimeout(() => this.cancelOwner(owner), TASK_DEADLINE_MS),
				job: null,
				running: false,
				failure: null,
			};
			owner.timer.unref();
			this.records.set(task.taskId, owner);
			const accepted = snapshot(task);
			this.schedule();
			return accepted;
		});
		this.preparing.set(controller, pending);
		try {
			return await pending;
		} finally {
			this.preparing.delete(controller);
		}
	}

	async list(
		token: string | null,
		after: string | null,
	): Promise<{ items: ServerTransferTask[]; nextCursor: string | null }> {
		const identity = await this.identity(token);
		const rows = [...this.records.values()]
			.filter((owner) => owner.userId === identity.userId && (after === null || owner.task.taskId > after))
			.sort((a, b) => a.task.taskId.localeCompare(b.task.taskId));
		const items = rows.slice(0, SERVER_TRANSFER_PAGE_SIZE).map((owner) => snapshot(owner.task));
		return { items, nextCursor: rows.length > SERVER_TRANSFER_PAGE_SIZE ? (items.at(-1)?.taskId ?? null) : null };
	}

	async details(token: string | null, id: string): Promise<ServerTransferTask> {
		return snapshot((await this.owned(token, id)).task);
	}

	async cancel(token: string | null, id: string): Promise<void> {
		const owner = await this.owned(token, id);
		if (final(owner.task) || owner.task.status === 'unknown') {
			throw new ServerTransferFailure('not_found');
		}
		this.cancelOwner(owner);
	}

	async remove(token: string | null, id: string): Promise<void> {
		const owner = await this.owned(token, id);
		if (!final(owner.task) || owner.running) {
			throw new ServerTransferFailure('resource_active');
		}
		clearTimeout(owner.timer);
		this.records.delete(id);
	}

	private async identity(token: string | null): Promise<{ userId: number }> {
		let identity;
		try {
			identity = await this.access.authenticate(token);
		} catch (cause) {
			throw new ServerTransferFailure('storage_unavailable', 'not_started', { cause });
		}
		if (!identity || identity.userId !== 1) {
			throw new ServerTransferFailure(identity === null ? 'unauthenticated' : 'forbidden');
		}
		return { userId: identity.userId };
	}

	private async owned(token: string | null, id: string): Promise<TaskOwner> {
		const identity = await this.identity(token);
		const owner = this.records.get(id);
		if (!owner || owner.userId !== identity.userId) {
			throw new ServerTransferFailure('not_found');
		}
		return owner;
	}

	private async validate(owner: TaskOwner): Promise<void> {
		if (owner.controller.signal.aborted || Date.now() >= owner.deadline) {
			throw new ServerTransferFailure('cancelled');
		}
		let identity;
		try {
			identity = await this.access.authenticateDigest(owner.digest);
		} catch (cause) {
			throw new ServerTransferFailure('storage_unavailable', 'not_started', { cause });
		}
		if (!identity || identity.userId !== owner.userId) {
			throw new ServerTransferFailure(identity === null ? 'unauthenticated' : 'forbidden');
		}
		await this.model.validate(owner.plan);
		if (owner.controller.signal.aborted || Date.now() >= owner.deadline) {
			throw new ServerTransferFailure('cancelled');
		}
	}

	private cancelOwner(owner: TaskOwner): void {
		if (final(owner.task) || owner.task.status === 'unknown') {
			return;
		}
		owner.controller.abort();
		owner.task.status = 'cancelling';
		logDiagnostic(this.logger, 'info', 'SERVER_TRANSFER_CANCEL_REQUESTED', { taskId: owner.task.taskId });
		if (!owner.running) {
			for (const item of owner.task.subTasks) {
				item.status = 'cancelled';
			}
			this.finish(owner);
		}
	}

	private schedule(): void {
		if (this.stopping) {
			return;
		}
		const running = [...this.records.values()].filter((owner) => owner.running);
		const busy = new Set(running.flatMap((owner) => owner.plan.resources));
		let count = running.length;
		for (const owner of this.records.values()) {
			if (count >= MAX_CONCURRENT) {
				break;
			}
			if (
				owner.running ||
				owner.task.status !== 'queued' ||
				owner.plan.resources.some((resource) => busy.has(resource))
			) {
				continue;
			}
			owner.running = true;
			count += 1;
			for (const resource of owner.plan.resources) {
				busy.add(resource);
			}
			owner.job = this.mutations
				.ownExecution(() => withDiagnosticContext({ taskId: owner.task.taskId }, () => this.process(owner)))
				.catch((cause) => {
					owner.failure = cause;
					for (const item of owner.task.subTasks) {
						if (!['completed', 'failed', 'cancelled', 'unknown'].includes(item.status)) {
							item.status = 'unknown';
							item.error = 'operation_unknown';
						}
					}
				})
				.finally(() => {
					owner.running = false;
					this.finish(owner);
					this.schedule();
				});
		}
	}

	private async process(owner: TaskOwner): Promise<void> {
		owner.task.status = 'in-progress';
		logDiagnostic(this.logger, 'info', 'SERVER_TRANSFER_STARTED', {
			taskId: owner.task.taskId,
			subTasks: owner.task.subTasks.length,
		});
		let monitoring: Promise<void> | null = null;
		const monitor = setInterval(() => {
			if (!monitoring && !owner.controller.signal.aborted) {
				monitoring = this.validate(owner)
					.catch((cause) => {
						owner.failure = cause;
						owner.controller.abort();
					})
					.finally(() => {
						monitoring = null;
					});
			}
		}, 1000);
		monitor.unref();
		try {
			for (const item of owner.task.subTasks) {
				if (owner.controller.signal.aborted) {
					item.status = 'cancelled';
					continue;
				}
				item.status = 'connecting';
				try {
					await this.validate(owner);
					const target = owner.plan.targets.find((ref) => ref.targetId === item.connectionId);
					if (!target) {
						throw new ServerTransferFailure('invalid_input');
					}
					const method = await this.mutations.run(
						'server-transfer:' + item.subTaskId,
						'files',
						[owner.plan.source, { targetId: target.targetId, fingerprint: target.fingerprint }],
						() =>
							this.model.execute({
								executionId: item.subTaskId,
								command: owner.task.payload,
								plan: owner.plan,
								targetId: item.connectionId,
								sourceIndex: item.sourceItemIndex,
								deadline: owner.deadline,
								signal: owner.controller.signal,

								validate: () => this.validate(owner),

								onMethod: (method) => {
									item.transferMethodUsed = method;
									item.status = 'transferring';
									owner.task.updatedAt = Math.max(owner.task.updatedAt, Date.now());
								},
							}),
						{ userId: owner.userId, digest: owner.digest },
					);
					item.transferMethodUsed = method;
					item.status = 'completed';
					item.progress = 100;
				} catch (cause) {
					logDiagnostic(
						this.logger,
						'warn',
						'SERVER_TRANSFER_ITEM_FAILED',
						{ taskId: owner.task.taskId, subTaskId: item.subTaskId, connectionId: item.connectionId },
						cause,
					);
					const error = classify(cause);
					item.status =
						error.outcome === 'unknown' ? 'unknown' : error.code === 'cancelled' ? 'cancelled' : 'failed';
					item.error = item.status === 'cancelled' ? null : error.code;
					if (
						error.outcome === 'unknown' ||
						['unauthenticated', 'forbidden', 'stale_target', 'storage_unavailable'].includes(error.code)
					) {
						owner.failure = cause;
						owner.controller.abort();
					}
				}
				owner.task.overallProgress = Math.floor(
					owner.task.subTasks.reduce((sum, sub) => sum + sub.progress, 0) / owner.task.subTasks.length,
				);
				owner.task.updatedAt = Math.max(owner.task.updatedAt, Date.now());
			}
		} finally {
			clearInterval(monitor);
			await monitoring;
		}
	}

	private finish(owner: TaskOwner): void {
		clearTimeout(owner.timer);
		owner.task.status = settledStatus(owner.task);
		logDiagnostic(
			this.logger,
			owner.task.status === 'completed' ? 'info' : 'warn',
			'SERVER_TRANSFER_SETTLED',
			{ taskId: owner.task.taskId, status: owner.task.status },
			owner.failure ?? undefined,
		);
		owner.task.updatedAt = Math.max(owner.task.updatedAt, Date.now());
		this.prune();
	}

	private prune(): void {
		const records = [...this.records.values()]
			.filter((owner) => final(owner.task) && !owner.running)
			.sort((a, b) => b.task.updatedAt - a.task.updatedAt);
		for (const owner of records.slice(MAX_HISTORY)) {
			this.records.delete(owner.task.taskId);
		}
	}

	quiesce(): void {
		this.stopping = true;
		for (const controller of this.preparing.keys()) {
			controller.abort();
		}
		for (const owner of this.records.values()) {
			this.cancelOwner(owner);
		}
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.quiesce();
			this.closePromise = Promise.resolve().then(async () => {
				await Promise.allSettled([
					...this.preparing.values(),
					...[...this.records.values()].flatMap((owner) => (owner.job ? [owner.job] : [])),
				]);
				const failures = [...this.records.values()]
					.filter((owner) => owner.task.status === 'unknown')
					.map((owner) => owner.failure ?? new ServerTransferFailure('operation_unknown', 'unknown'));
				if (failures.length) {
					throw new RemoteResourceCleanupFailure(failures);
				}
			});
		}
		return this.closePromise;
	}
}
