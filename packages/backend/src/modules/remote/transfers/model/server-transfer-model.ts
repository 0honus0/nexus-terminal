import type { TrustedSshTargetResolver, HostKeyManagement } from '../../../targets/public.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import type { RemoteMachineModel } from '../../machines/model/machine-model.js';
import { RemoteHostKeyUntrustedError } from '../../machines/model/machine-errors.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { MachineConnection } from '../../../../platform/ssh/ssh-port.js';
import { NativeTransferFailure } from '../../../../platform/transfers/transfer-port.js';
import type { NativeTransferPort } from '../../../../platform/transfers/transfer-port.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { ServerTransferCommand, ServerTransferPlan, ServerTransferExecution } from './server-transfer-types.js';
import { ServerTransferFailure } from './server-transfer-types.js';
import type { ServerTransferMethodUsed } from '@nexus-terminal/shared/remote/transfers/server-values';

function failure(cause: unknown): ServerTransferFailure {
	if (cause instanceof ServerTransferFailure) {
		return cause;
	}
	if (cause instanceof AggregateError) {
		return new ServerTransferFailure('cleanup_failed', 'unknown', { cause });
	}
	if (cause instanceof NativeTransferFailure) {
		const codes = {
			invalid_endpoint: 'unsupported_endpoint',
			tool_missing: 'tool_unavailable',
			peer_unreachable: 'connection_failed',
			host_key_rejected: 'host_key_untrusted',
			command_failed: 'transfer_failed',
			transport_lost: 'operation_unknown',
			cleanup_unconfirmed: 'cleanup_failed',
		} as const;
		const code =
			cause.reason === 'transport_lost' && cause.outcome !== 'unknown'
				? 'connection_failed'
				: codes[cause.reason];
		return new ServerTransferFailure(code, cause.outcome, { cause });
	}
	if (cause instanceof TargetOperationError) {
		return new ServerTransferFailure(
			cause.code === 'conflict'
				? 'stale_target'
				: cause.code === 'reference_not_found'
					? 'not_found'
					: 'storage_unavailable',
			'not_started',
			{ cause },
		);
	}
	if (cause instanceof RemoteHostKeyUntrustedError) {
		return new ServerTransferFailure('host_key_untrusted', 'not_started', { cause });
	}
	return new ServerTransferFailure('connection_failed', 'not_started', { cause });
}

export class ServerTransferModel {
	constructor(
		private readonly resolver: TrustedSshTargetResolver,
		private readonly machines: RemoteMachineModel,
		private readonly pins: Pick<HostKeyManagement, 'list'>,
		private readonly native: NativeTransferPort,
		private readonly tokens: SessionTokens,
	) {}

	digest(token: string): string {
		return this.tokens.digest(token);
	}

	async prepare(command: ServerTransferCommand): Promise<ServerTransferPlan> {
		try {
			const source = await this.resolver.resolveStored({ targetId: command.sourceConnectionId });
			const pins = await this.pins.list();
			const resources = [source.host.toLowerCase() + ':' + source.port];
			const targets: ServerTransferPlan['targets'] = [];
			for (const id of command.connectionIds) {
				const target = await this.resolver.resolveStored({ targetId: id });
				const resource = target.host.toLowerCase() + ':' + target.port;
				resources.push(resource);
				const pin = pins.find(
					(item) => item.host.toLowerCase() === target.host.toLowerCase() && item.port === target.port,
				);
				targets.push({
					targetId: target.id,
					fingerprint: target.fingerprint,
					hostKeyFingerprint: pin?.fingerprint ?? null,
					pinKey: resource,
					direct: target.proxy === null && target.jumps.length === 0,
				});
			}
			const sourcePin = pins.find(
				(pin) => pin.host.toLowerCase() === source.host.toLowerCase() && pin.port === source.port,
			);
			return {
				source: { targetId: source.id, fingerprint: source.fingerprint },
				targets,
				resources,
				sourcePin: {
					key: source.host.toLowerCase() + ':' + source.port,
					fingerprint: sourcePin?.fingerprint ?? null,
				},
			};
		} catch (cause) {
			throw failure(cause);
		}
	}

	async validate(plan: ServerTransferPlan): Promise<void> {
		try {
			const pins = new Map(
				(await this.pins.list()).map((pin) => [pin.host.toLowerCase() + ':' + pin.port, pin.fingerprint]),
			);
			if (
				plan.sourcePin.fingerprint !== pins.get(plan.sourcePin.key) ||
				plan.targets.some((ref) => ref.hostKeyFingerprint !== pins.get(ref.pinKey))
			) {
				throw new ServerTransferFailure('host_key_untrusted');
			}
			for (const ref of [plan.source, ...plan.targets]) {
				if ((await this.resolver.fingerprintStored(ref.targetId)) !== ref.fingerprint) {
					throw new ServerTransferFailure('stale_target');
				}
			}
		} catch (cause) {
			throw failure(cause);
		}
	}

	async execute(input: ServerTransferExecution): Promise<ServerTransferMethodUsed> {
		const opened: MachineConnection[] = [];
		let outcome: ServerTransferMethodUsed | null = null;
		let error: ServerTransferFailure | null = null;
		try {
			const ref = input.plan.targets.find((item) => item.targetId === input.targetId);
			const sourceItem = input.command.sourceItems[input.sourceIndex];
			if (!ref || !sourceItem || ref.hostKeyFingerprint === null) {
				throw new ServerTransferFailure('invalid_input');
			}
			await input.validate();
			const target = await this.resolver.resolveStored({
				targetId: ref.targetId,
				expectedFingerprint: ref.fingerprint,
			});
			const pins = await this.pins.list();
			if (
				!pins.some(
					(pin) =>
						pin.host.toLowerCase() === target.host.toLowerCase() &&
						pin.port === target.port &&
						pin.fingerprint === ref.hostKeyFingerprint,
				)
			) {
				throw new ServerTransferFailure('host_key_untrusted');
			}
			const sourceMachine = await this.machines.open({
				targetId: input.plan.source.targetId,
				expectedFingerprint: input.plan.source.fingerprint,
				timeoutMs: Math.min(15_000, input.deadline - Date.now()),
				signal: input.signal,
				validate: input.validate,
			});
			opened.push(sourceMachine.machine);
			const targetMachine = await this.machines.open({
				targetId: ref.targetId,
				expectedFingerprint: ref.fingerprint,
				timeoutMs: Math.min(15_000, input.deadline - Date.now()),
				signal: input.signal,
				validate: input.validate,
			});
			opened.push(targetMachine.machine);
			const auth = target.authentication;
			outcome = await this.native.execute({
				executionId: input.executionId,
				source: sourceMachine.machine,
				target: targetMachine.machine,
				host: target.host,
				port: target.port,
				username: target.username,
				authentication:
					auth.kind === 'password'
						? { kind: 'password', password: auth.password }
						: { kind: 'private_key', privateKey: auth.privateKey, passphrase: auth.passphrase },
				hostKeyFingerprint: ref.hostKeyFingerprint,
				hostPublicKey: Uint8Array.from(targetMachine.hostPublicKey),
				sourcePath: sourceItem.path,
				directory: sourceItem.type === 'directory',
				targetDirectory: input.command.remoteTargetPath,
				method: input.command.transferMethod,
				deadline: input.deadline,
				signal: input.signal,
				validate: input.validate,

				onMethod: (method) => input.onMethod(method),

				onProgress: (bytes, percent) => input.onProgress(bytes, percent),

				onMutation: () => input.onMutation(),
			});
		} catch (cause) {
			error = failure(cause);
		} finally {
			const results = await Promise.allSettled(
				opened.map((machine) => Promise.resolve().then(() => machine.close())),
			);
			const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
			if (failures.length) {
				throw new RemoteResourceCleanupFailure(error ? [error, ...failures] : failures);
			}
		}
		if (error) {
			throw error;
		}
		if (outcome === null) {
			throw new ServerTransferFailure('operation_unknown', 'unknown');
		}
		return outcome;
	}
}
