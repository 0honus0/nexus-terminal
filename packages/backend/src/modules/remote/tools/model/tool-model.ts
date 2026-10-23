import type { RemoteMachineModel } from '../../machines/model/machine-model.js';
import type { TrustedSshTargetResolver } from '../../../targets/public.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import type { RemoteToolInstaller } from '../../../../platform/tools/tool-port.js';
import { ToolExecutionFailure } from '../../../../platform/tools/tool-port.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { MachineConnection } from '../../../../platform/ssh/ssh-port.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { RemoteHostKeyUntrustedError } from '../../machines/model/machine-errors.js';
import {
	RemoteToolFailure,
	type ToolInspectionInput,
	type ToolInspection,
	type ToolInstallScope,
	type ToolTransferCredential,
} from './tool-types.js';

function failure(cause: unknown): RemoteToolFailure {
	if (cause instanceof RemoteToolFailure) {
		return cause;
	}
	if (cause instanceof ToolExecutionFailure) {
		return new RemoteToolFailure(cause.reason, { cause });
	}
	if (cause instanceof RemoteHostKeyUntrustedError) {
		return new RemoteToolFailure('host_key_untrusted', { cause });
	}
	if (cause instanceof TargetOperationError) {
		return new RemoteToolFailure(
			cause.code === 'reference_not_found'
				? 'not_found'
				: cause.code === 'conflict'
					? 'stale_plan'
					: 'unavailable',
			{ cause },
		);
	}
	return new RemoteToolFailure('unavailable', { cause });
}

/** The model alone acquires transports; no machine handle or credential reaches Service. */
export class RemoteToolModel {
	private readonly retained = new Set<MachineConnection>();

	constructor(
		private readonly machines: RemoteMachineModel,
		private readonly resolver: TrustedSshTargetResolver,
		private readonly installer: RemoteToolInstaller,
		private readonly tokens: SessionTokens,
	) {}

	digest(token: string): string {
		return this.tokens.digest(token);
	}

	async transferCredential(targetId: number): Promise<ToolTransferCredential> {
		try {
			const target = await this.resolver.resolveStored({ targetId });
			return {
				kind: target.authentication.kind === 'password' ? 'password' : 'private_key',
				hasPassphrase: target.authentication.kind === 'ssh_key' && target.authentication.passphrase !== null,
			};
		} catch (cause) {
			throw failure(cause);
		}
	}

	async inspect(input: ToolInspectionInput, scope: ToolInstallScope): Promise<ToolInspection> {
		try {
			return await this.withMachine(input.targetId, undefined, scope, async (machine, fingerprint) => {
				const value = await this.installer.inspect(
					machine,
					input.tools.map((tool) => tool),
					{ signal: scope.signal, remaining: scope.remaining },
				);
				await scope.validate();
				return {
					targetId: input.targetId,
					fingerprint,
					tools: input.tools.map((tool) => tool),
					missing: value.missing.map((tool) => tool),
					manager: value.manager,
					privilege: value.privilege,
				};
			});
		} catch (cause) {
			if (cause instanceof RemoteResourceCleanupFailure) {
				throw cause;
			}
			throw failure(cause);
		}
	}

	async install(plan: ToolInspection, password: string | undefined, scope: ToolInstallScope): Promise<void> {
		try {
			await this.withMachine(plan.targetId, plan.fingerprint, scope, async (machine) => {
				const current = await this.installer.inspect(
					machine,
					plan.tools.map((tool) => tool),
					{ signal: scope.signal, remaining: scope.remaining },
				);
				if (!current.missing.length) {
					return;
				}
				if (
					current.manager !== plan.manager ||
					current.privilege !== plan.privilege ||
					current.missing.some((tool) => !plan.missing.includes(tool))
				) {
					throw new RemoteToolFailure('stale_plan');
				}
				if (current.manager === null || current.privilege === 'unavailable') {
					throw new RemoteToolFailure('unsupported');
				}
				await this.resolver.resolveStored({ targetId: plan.targetId, expectedFingerprint: plan.fingerprint });
				await scope.validate();
				scope.signal.throwIfAborted();
				try {
					await this.installer.install(
						machine,
						current.missing.map((tool) => tool),
						current.manager,
						current.privilege,
						password,
						{ signal: scope.signal, remaining: scope.remaining },
					);
				} catch (cause) {
					if (cause instanceof ToolExecutionFailure) {
						throw cause;
					}
					throw new RemoteToolFailure('operation_unknown', { cause });
				}
			});
		} catch (cause) {
			if (cause instanceof RemoteResourceCleanupFailure) {
				throw cause;
			}
			throw failure(cause);
		}
	}

	private async withMachine<T>(
		targetId: number,
		fingerprint: string | undefined,
		scope: ToolInstallScope,
		work: (machine: MachineConnection, fingerprint: string) => Promise<T>,
	): Promise<T> {
		const opened = await this.machines.open({
			targetId,
			...(fingerprint === undefined ? {} : { expectedFingerprint: fingerprint }),
			timeoutMs: scope.remaining(),
			signal: scope.signal,
			validate: scope.validate,
		});
		this.retained.add(opened.machine);
		const errors: unknown[] = [];
		let result: T;
		try {
			result = await work(opened.machine, opened.target.fingerprint);
		} catch (cause) {
			errors.push(cause);
			throw cause;
		} finally {
			try {
				await opened.machine.close();
				this.retained.delete(opened.machine);
			} catch (cause) {
				throw new RemoteResourceCleanupFailure([...errors, cause]);
			}
		}
		return result;
	}

	async close(): Promise<void> {
		const results = await Promise.allSettled(
			[...this.retained].map(async (machine) => {
				await machine.close();
				this.retained.delete(machine);
			}),
		);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			throw new RemoteResourceCleanupFailure(failures);
		}
	}
}
