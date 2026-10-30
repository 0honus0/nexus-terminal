import type { RemoteMachineModel } from './machine-model.js';
import type {
	ConnectionTestCommand,
	ConnectionTestScope,
	ConnectionTestResult,
	UnsavedConnectionTest,
} from './connection-test-types.js';
import type { TrustedUnsavedSshRequest } from '../../../targets/public.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import type { MachineConnection } from '../../../../platform/ssh/ssh-port.js';
import { RemoteHostKeyUntrustedError } from './machine-errors.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { ConnectionTestFailure } from '../../connection-test-failure.js';
import { ConnectionTestHostKeyFailure } from './connection-test-errors.js';

function toDraft(value: UnsavedConnectionTest): TrustedUnsavedSshRequest {
	const auth = value.authentication;
	return {
		host: value.host,
		port: value.port,
		username: value.username,
		authentication:
			auth.kind === 'password'
				? { kind: 'password', password: auth.password }
				: auth.kind === 'ssh_key'
					? { kind: 'ssh_key', sshKeyId: auth.sshKeyId }
					: { kind: 'private_key', privateKey: auth.privateKey, passphrase: auth.passphrase },
		route: value.route,
		proxyId: value.proxyId,
		jumpIds: value.jumpIds.map((id) => id),
	};
}

function failure(cause: unknown, aborted: boolean): ConnectionTestFailure {
	if (cause instanceof ConnectionTestFailure) {
		return cause;
	}
	if (cause instanceof RemoteResourceCleanupFailure) {
		return new ConnectionTestFailure('cleanup_failed', { cause });
	}
	if (cause instanceof TargetOperationError) {
		const code = cause.code;
		return new ConnectionTestFailure(
			code === 'invalid_input' || code === 'reference_not_found' || code === 'unresolvable' || code === 'conflict'
				? code
				: code === 'storage_unavailable' || code === 'operation_unknown'
					? 'storage_unavailable'
					: 'internal_failure',
			{ cause },
		);
	}
	if (cause instanceof RemoteHostKeyUntrustedError) {
		return new ConnectionTestHostKeyFailure(
			{
				host: cause.hostKey.host,
				port: cause.hostKey.port,
				fingerprint: cause.hostKey.fingerprint,
				expectedFingerprint: cause.hostKey.expectedFingerprint,
			},
			cause,
		);
	}
	return new ConnectionTestFailure(aborted ? 'unavailable' : 'connection_failed', { cause });
}

/** Only the conversion boundary sees the transport. A successful test never opens a channel. */
export class ConnectionTestModel {
	private readonly retained = new Set<MachineConnection>();

	constructor(private readonly machines: RemoteMachineModel) {}

	async test(command: ConnectionTestCommand, scope: ConnectionTestScope): Promise<ConnectionTestResult> {
		let machine: MachineConnection;
		const started = performance.now();
		try {
			const options = { signal: scope.signal, timeoutMs: scope.timeoutMs, validate: scope.validate };
			machine =
				command.kind === 'stored'
					? (
							await this.machines.open({
								targetId: command.targetId,
								signal: options.signal,
								timeoutMs: options.timeoutMs,
								validate: options.validate,
							})
						).machine
					: await this.machines.openUnsaved(toDraft(command.target), options);
		} catch (cause) {
			if (cause instanceof RemoteHostKeyUntrustedError) {
				await scope.validate();
				scope.signal.throwIfAborted();
			}
			throw failure(cause, scope.signal.aborted);
		}
		const latencyMs = Math.max(0, Math.round(performance.now() - started));
		this.retained.add(machine);
		try {
			await machine.close();
			this.retained.delete(machine);
		} catch (cause) {
			throw new ConnectionTestFailure('cleanup_failed', { cause });
		}
		scope.signal.throwIfAborted();
		await scope.validate();
		scope.signal.throwIfAborted();
		return { latencyMs };
	}

	async close(): Promise<void> {
		const outcomes = await Promise.allSettled(
			[...this.retained].map(async (machine) => {
				await machine.close();
				this.retained.delete(machine);
			}),
		);
		const failures = outcomes.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			throw new AggregateError(failures, 'Connection test resources did not close');
		}
	}
}
