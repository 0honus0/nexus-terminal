import type { MachineCommandExecutor } from '../../../../platform/ssh/ssh-port.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import { DOCKER_MAX_CONTAINERS } from '@nexus-terminal/shared/remote/docker/values';
import type { ConnectionCatalog, TrustedSshTargetResolver } from '../../../targets/public.js';
import { OBSERVATION_MAX_RESOURCES } from '@nexus-terminal/shared/remote/monitoring/values';
import type { ObservationTarget } from './observation-types.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { RemoteMachineModel } from '../../machines/model/machine-model.js';
import { RemoteHostKeyUntrustedError } from '../../machines/model/machine-errors.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { MachineStatusCollector, MachineStatus } from '../../../../platform/system/status-port.js';
import {
	DockerFailure,
	type DockerPort,
	type DockerStatus,
	type DockerStats,
} from '../../../../platform/docker/docker-port.js';
import { MachineDispatchFailure } from '../../../../platform/ssh/ssh-port.js';
import {
	ObservationFailure,
	type ObservationSample,
	type ObservedDockerStatus,
	type ObservedDockerStats,
	type ObservationScope,
	type ObservationDockerAction,
} from './observation-types.js';

function sample(value: MachineStatus): ObservationSample {
	return {
		cpuPercent: value.cpuPercent,
		memPercent: value.memPercent,
		memUsed: value.memUsed,
		memTotal: value.memTotal,
		swapPercent: value.swapPercent,
		swapUsed: value.swapUsed,
		swapTotal: value.swapTotal,
		diskPercent: value.diskPercent,
		diskUsed: value.diskUsed,
		diskTotal: value.diskTotal,
		cpuModel: value.cpuModel,
		netRxRate: value.netRxRate,
		netTxRate: value.netTxRate,
		netInterface: value.netInterface,
		osName: value.osName,
		loadAvg: value.loadAvg?.map((number) => number),
		timestamp: value.timestamp,
	};
}

function dockerStats(value: DockerStats): ObservedDockerStats {
	return {
		id: value.id,
		name: value.name,
		cpuPercent: value.cpuPercent,
		memoryUsage: value.memoryUsage,
		memoryPercent: value.memoryPercent,
		networkIO: value.networkIO,
		blockIO: value.blockIO,
		processes: value.processes,
	};
}

function dockerStatus(value: DockerStatus): ObservedDockerStatus {
	if (value.containers.length > DOCKER_MAX_CONTAINERS) {
		throw new ObservationFailure('limit_exceeded');
	}
	return {
		available: value.available,
		containers: value.containers.map((row) => ({
			id: row.id,
			names: row.names.map((name) => name),
			image: row.image,
			imageId: row.imageId,
			command: row.command,
			created: row.created,
			state: row.state,
			status: row.status,
			ports: row.ports.map((port) => ({
				ip: port.ip,
				privatePort: port.privatePort,
				publicPort: port.publicPort,
				protocol: port.protocol,
			})),
			labels: row.labels,
			stats: row.stats === null ? null : dockerStats(row.stats),
		})),
	};
}

export class ObservationModel {
	constructor(
		private readonly machines: RemoteMachineModel,
		private readonly collector: MachineStatusCollector,
		private readonly docker: DockerPort,
		private readonly catalog: ConnectionCatalog,
		private readonly resolver: TrustedSshTargetResolver,
	) {}

	private async withMachine<T>(
		scope: ObservationScope,
		operation: (execute: MachineCommandExecutor) => Promise<T>,
		policy: { mutation: boolean } = { mutation: false },
	): Promise<T> {
		let machine: Awaited<ReturnType<RemoteMachineModel['open']>>['machine'] | null = null;
		let failure: unknown = null;
		let value: { result: T } | null = null;
		const deadline = Date.now() + 45000;
		try {
			await scope.validate();
			const opened = await this.machines.open({
				targetId: scope.targetId,
				expectedFingerprint: scope.fingerprint,
				timeoutMs: 5000,
				signal: scope.signal,
			});
			machine = opened.machine;
			const connected = machine;

			const execute: MachineCommandExecutor = async (command, options) => {
				await scope.validate();
				scope.signal.throwIfAborted();
				const remaining = deadline - Date.now();
				if (remaining < 1) {
					throw new ObservationFailure('remote_unavailable');
				}
				return connected.execute(command, {
					timeoutMs: Math.min(remaining, options.timeoutMs),
					maxOutputBytes: options.maxOutputBytes,
					signal: scope.signal,
				});
			};

			value = { result: await operation(execute) };
			await scope.validate();
		} catch (error) {
			failure =
				policy.mutation && value !== null
					? new ObservationFailure('operation_unknown', { cause: error })
					: error;
		}
		if (machine) {
			try {
				await machine.close();
			} catch (cleanup) {
				throw new RemoteResourceCleanupFailure(failure === null ? [cleanup] : [failure, cleanup]);
			}
		}
		if (failure !== null) {
			if (failure instanceof RemoteResourceCleanupFailure || failure instanceof ObservationFailure) {
				throw failure;
			}
			if (failure instanceof RemoteHostKeyUntrustedError) {
				throw new ObservationFailure('host_key_untrusted', { cause: failure });
			}
			if (failure instanceof TargetOperationError) {
				const code =
					failure.code === 'conflict'
						? 'conflict'
						: failure.code === 'reference_not_found'
							? 'not_found'
							: 'remote_unavailable';
				throw new ObservationFailure(code, { cause: failure });
			}
			if (failure instanceof DockerFailure) {
				throw new ObservationFailure(
					failure.reason === 'unknown'
						? 'operation_unknown'
						: failure.reason === 'failed'
							? 'command_failed'
							: 'remote_unavailable',
					{ cause: failure },
				);
			}
			if (failure instanceof MachineDispatchFailure) {
				throw new ObservationFailure(
					failure.outcome === 'unknown' ? 'operation_unknown' : 'remote_unavailable',
					{ cause: failure },
				);
			}
			throw new ObservationFailure('remote_unavailable', { cause: failure });
		}
		if (value === null) {
			throw new ObservationFailure('remote_unavailable');
		}
		try {
			await scope.validate();
		} catch (error) {
			throw new ObservationFailure(policy.mutation ? 'operation_unknown' : 'remote_unavailable', {
				cause: error,
			});
		}
		return value.result;
	}

	collect(scope: ObservationScope, key: string, bootstrap = false): Promise<ObservationSample> {
		return this.withMachine(scope, async (execute) => {
			let value = await this.collector.collect(execute, key, scope.signal);
			if (bootstrap) {
				await delay(500, undefined, { signal: scope.signal });
				value = await this.collector.collect(execute, key, scope.signal);
			}
			return sample(value);
		});
	}

	async listTargets(signal?: AbortSignal): Promise<ObservationTarget[]> {
		signal?.throwIfAborted();
		const rows = (await this.catalog.list()).filter((row) => row.type === 'SSH');
		if (rows.length > OBSERVATION_MAX_RESOURCES) {
			throw new ObservationFailure('limit_exceeded');
		}
		const result: ObservationTarget[] = [];
		let index = 0;

		const worker = async () => {
			while (index < rows.length) {
				signal?.throwIfAborted();
				const row = rows[index++];
				if (!row) {
					continue;
				}
				let fingerprint: string | null;
				try {
					fingerprint = await this.resolver.fingerprintStored(row.id);
				} catch (error) {
					if (
						!(error instanceof TargetOperationError) ||
						(error.code !== 'unresolvable' && error.code !== 'reference_not_found')
					) {
						throw new ObservationFailure('remote_unavailable', { cause: error });
					}
					fingerprint = null;
				}
				result.push({
					id: row.id,
					name: row.name,
					host: row.host,
					port: row.port,
					username: row.username ?? '',
					fingerprint,
					revision: row.version,
				});
			}
		};

		const outcomes = await Promise.allSettled(Array.from({ length: Math.min(2, rows.length) }, worker));
		const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
		if (failures.length) {
			if (failures.length > 1) {
				throw new ObservationFailure('remote_unavailable', {
					cause: new AggregateError(failures.map((failure) => failure.reason)),
				});
			}
			throw failures[0]?.reason;
		}
		return result.sort((a, b) => a.id - b.id);
	}

	clear(key: string): void {
		this.collector.clear(key);
	}

	getDocker(scope: ObservationScope): Promise<ObservedDockerStatus> {
		return this.withMachine(scope, async (execute) =>
			dockerStatus(await this.docker.status(execute, scope.signal)),
		);
	}

	getDockerStats(scope: ObservationScope, id: string): Promise<ObservedDockerStats | null> {
		return this.withMachine(scope, async (execute) => {
			const value = await this.docker.stats(execute, id, scope.signal);
			return value === null ? null : dockerStats(value);
		});
	}

	commandDocker(scope: ObservationScope, id: string, action: ObservationDockerAction): Promise<void> {
		return this.withMachine(scope, (execute) => this.docker.command(execute, id, action, scope.signal), {
			mutation: true,
		});
	}
}
