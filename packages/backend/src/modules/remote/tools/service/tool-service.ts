import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic } from '../../../../platform/logging/diagnostic-log.js';
import { randomUUID } from 'node:crypto';
import type { AccessPublicApi } from '../../../access/public.js';
import type { RemoteToolModel } from '../model/tool-model.js';
import {
	RemoteToolFailure,
	type ToolCheckIntent,
	type ToolCheckResult,
	type ToolInspection,
	type ToolInstallScope,
} from '../model/tool-types.js';
import type { MachineMutationService } from '../../machines/service/mutation-service.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import { isToolPassword, type RemoteTool } from '@nexus-terminal/shared/remote/tools/values';

interface InstallPlan {
	inspection: ToolInspection;
	digest: string;
	expiresAt: number;
}

export class RemoteToolService {
	private readonly plans = new Map<string, InstallPlan>();
	private readonly tasks = new Map<AbortController, Promise<unknown>>();
	private readonly failures = new FailureSummary();
	private stopping = false;
	private blocked = false;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly access: AccessPublicApi,
		private readonly model: RemoteToolModel,
		private readonly mutations: MachineMutationService,
		private readonly logger?: Logger,
	) {}

	check(token: string | null, intent: ToolCheckIntent, signal: AbortSignal): Promise<ToolCheckResult> {
		return this.run(token, signal, 30_000, async (scope, digest) => {
			const inspection = await this.inspect(intent, scope);
			await scope.validate();
			let planId: string | null = null;
			let expiresAt: number | null = null;
			if (inspection.missing.length && inspection.manager !== null && inspection.privilege !== 'unavailable') {
				for (const [key, plan] of this.plans) {
					if (plan.expiresAt <= Date.now()) {
						this.plans.delete(key);
					}
				}
				// Pending read-only offers may be evicted; active installs are tracked separately.
				while (this.plans.size >= 128) {
					const oldest = this.plans.keys().next().value;
					if (oldest !== undefined) {
						this.plans.delete(oldest);
					}
				}
				planId = randomUUID();
				expiresAt = Date.now() + 5 * 60_000;
				this.plans.set(planId, { inspection, digest, expiresAt });
			}
			return { inspection, planId, expiresAt };
		});
	}

	private async inspect(intent: ToolCheckIntent, scope: ToolInstallScope): Promise<ToolInspection> {
		if (intent.kind === 'tools') {
			return this.model.inspect({ targetId: intent.targetId, tools: intent.tools.map((tool) => tool) }, scope);
		}
		const extras: RemoteTool[] = [];
		if (intent.side === 'source') {
			extras.push('ssh');
			const credential = await this.model.transferCredential(intent.peerId);
			if (credential.kind === 'password' || credential.hasPassphrase) {
				extras.push('sshpass');
			}
		}
		// Auto prepares the preferred tool first. Only an explicit user decline
		// in the consumer advances to another transfer method.
		const method = intent.method === 'scp' ? 'scp' : 'rsync';
		const tools: RemoteTool[] = [method, ...extras];
		const local = await this.model.inspect({ targetId: intent.targetId, tools }, scope);
		return {
			targetId: local.targetId,
			fingerprint: local.fingerprint,
			tools,
			missing: local.missing.filter((tool) => tools.includes(tool)),
			manager: local.manager,
			privilege: local.privilege,
		};
	}

	install(
		token: string | null,
		planId: string,
		password: string | undefined,
		signal: AbortSignal,
	): Promise<{ targetId: number }> {
		return this.run(token, signal, 180_000, async (scope, digest) => {
			const plan = this.plans.get(planId);
			if (!plan || plan.digest !== digest || plan.expiresAt <= Date.now()) {
				throw new RemoteToolFailure('stale_plan');
			}
			const needsPassword = plan.inspection.privilege === 'password';
			if (needsPassword !== (password !== undefined) || (password !== undefined && !isToolPassword(password))) {
				throw new RemoteToolFailure('invalid_input');
			}
			logDiagnostic(this.logger, 'info', 'REMOTE_TOOLS_INSTALL_STARTED', {
				targetId: plan.inspection.targetId,
				manager: plan.inspection.manager,
				privilege: plan.inspection.privilege,
				missingCount: plan.inspection.missing.length,
			});
			this.plans.delete(planId);
			const installationScope: ToolInstallScope = {
				signal: scope.signal,
				remaining: scope.remaining,

				validate: async () => {
					await scope.validate();
					if (plan.expiresAt <= Date.now()) {
						throw new RemoteToolFailure('stale_plan');
					}
				},
			};
			await this.mutations.run(
				'tools:' + planId,
				'tools',
				[{ targetId: plan.inspection.targetId, fingerprint: plan.inspection.fingerprint }],
				async () => {
					await installationScope.validate();
					await this.model.install(plan.inspection, password, installationScope);
				},
				{ userId: 1, digest },
			);
			await scope.validate();
			logDiagnostic(this.logger, 'info', 'REMOTE_TOOLS_INSTALL_COMPLETED', {
				targetId: plan.inspection.targetId,
			});
			return { targetId: plan.inspection.targetId };
		});
	}

	private run<T>(
		token: string | null,
		signal: AbortSignal,
		timeoutMs: number,
		work: (scope: ToolInstallScope, digest: string) => Promise<T>,
	): Promise<T> {
		if (this.stopping || this.blocked || this.tasks.size >= 16) {
			return Promise.reject(
				new RemoteToolFailure(
					this.stopping ? 'shutting_down' : this.blocked ? 'unavailable' : 'limit_exceeded',
				),
			);
		}
		const controller = new AbortController();

		const cancel = () => controller.abort();

		signal.addEventListener('abort', cancel, { once: true });
		if (signal.aborted) {
			cancel();
		}
		const timer = setTimeout(cancel, timeoutMs);
		const deadline = Date.now() + timeoutMs;

		const remaining = () => {
			const value = deadline - Date.now();
			if (value <= 0) {
				controller.abort();
			}
			controller.signal.throwIfAborted();
			return value;
		};

		const scope: ToolInstallScope = {
			signal: controller.signal,
			remaining,

			validate: async () => {
				remaining();
				const actor = await this.access.authenticate(token);
				remaining();
				if (!actor || actor.userId !== 1) {
					throw new RemoteToolFailure(actor ? 'forbidden' : 'unauthenticated');
				}
			},
		};
		const task = Promise.resolve()
			.then(async () => {
				await scope.validate();
				if (!token) {
					throw new RemoteToolFailure('unauthenticated');
				}
				return await work(scope, this.model.digest(token));
			})
			.catch((cause: unknown) => {
				logDiagnostic(this.logger, 'warn', 'REMOTE_TOOLS_OPERATION_FAILED', {}, cause);
				if (cause instanceof RemoteResourceCleanupFailure) {
					this.blocked = true;
					this.failures.record(cause);
					throw new RemoteToolFailure('operation_unknown', { cause });
				}
				if (cause instanceof RemoteToolFailure) {
					throw cause;
				}
				if (cause instanceof RemoteFileFailure) {
					throw new RemoteToolFailure(
						cause.code === 'conflict' ||
							cause.code === 'limit_exceeded' ||
							cause.code === 'unauthenticated' ||
							cause.code === 'forbidden' ||
							cause.code === 'operation_unknown'
							? cause.code
							: 'unavailable',
						{ cause },
					);
				}
				throw new RemoteToolFailure('unavailable', { cause });
			})
			.finally(() => {
				clearTimeout(timer);
				signal.removeEventListener('abort', cancel);
				this.tasks.delete(controller);
			});
		this.tasks.set(controller, task);
		return task;
	}

	quiesce(): void {
		this.stopping = true;
		this.plans.clear();
		for (const controller of this.tasks.keys()) {
			controller.abort();
		}
	}

	close(): Promise<void> {
		this.closePromise ??= Promise.resolve().then(async () => {
			await Promise.allSettled([...this.tasks.values()]);
			try {
				await this.model.close();
			} catch (cause) {
				this.failures.record(cause);
			}
			const failures = this.failures.errors();
			if (failures.length) {
				throw new AggregateError(failures, 'Tool installer cleanup failed');
			}
		});
		this.quiesce();
		return this.closePromise;
	}
}
