import type {
	ObservationSample,
	ObservedDockerStatus,
	ObservedDockerStats,
	ObservedSshResource,
} from '../monitoring/model/observation-types.js';
import type { RemoteStatusSample, SshResourceStatus } from '@nexus-terminal/shared/remote/monitoring/model';
import type { WorkspaceDockerStatus, WorkspaceDockerStats } from '@nexus-terminal/shared/remote/docker/workspace';

export function observationSample(value: ObservationSample): RemoteStatusSample {
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
		netRxRate: value.netRxRate,
		netTxRate: value.netTxRate,
		cpuModel: value.cpuModel,
		netInterface: value.netInterface,
		osName: value.osName,
		loadAvg: value.loadAvg?.map((number) => number),
		timestamp: value.timestamp,
	};
}

export function observedResource(value: ObservedSshResource): SshResourceStatus {
	if (value.status !== undefined) {
		return {
			key: value.key,
			connectionId: value.connectionId,
			name: value.name,
			username: value.username,
			host: value.host,
			port: value.port,
			status: observationSample(value.status),
			checkedAt: value.checkedAt,
		};
	}
	return {
		key: value.key,
		connectionId: value.connectionId,
		name: value.name,
		username: value.username,
		host: value.host,
		port: value.port,
		error: value.error,
		checkedAt: value.checkedAt,
	};
}

export function observedDockerStats(value: ObservedDockerStats): WorkspaceDockerStats {
	return {
		id: value.id,
		name: value.name,
		cpuPercent: value.cpuPercent,
		memoryUsage: value.memoryUsage,
		memoryPercent: value.memoryPercent,
		networkIo: value.networkIO,
		blockIo: value.blockIO,
		pids: value.processes,
	};
}

export function observedDockerStatus(value: ObservedDockerStatus): WorkspaceDockerStatus {
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
				type: port.protocol,
			})),
			labels: row.labels,
			stats: row.stats === null ? null : observedDockerStats(row.stats),
		})),
	};
}
