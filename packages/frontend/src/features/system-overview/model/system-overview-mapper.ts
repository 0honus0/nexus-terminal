import type { LocalSystemStatus } from '@nexus-terminal/shared/system/status/model';
import type { SshResourceStatus } from '@nexus-terminal/shared/remote/monitoring/model';
import type { LocalResourceStatus, SshResource, SshResourceTarget, ResourceFailureCode } from './system-overview-types';

export function toLocalResource(value: LocalSystemStatus): LocalResourceStatus {
	return {
		cpuPercent: value.cpuPercent,
		memPercent: value.memPercent,
		memUsed: value.memUsed,
		memTotal: value.memTotal,
		diskPercent: value.diskPercent,
		diskUsed: value.diskUsed,
		diskTotal: value.diskTotal,
	};
}

export function resourceKey(host: string, port: number): string {
	return `${host.trim().toLowerCase()}:${port}`;
}

export function toSshResource(value: SshResourceStatus): SshResource {
	if (value.status) {
		return {
			key: value.key,
			connectionId: value.connectionId,
			name: value.name,
			username: value.username,
			host: value.host,
			port: value.port,
			state: 'ready',
			checkedAt: value.checkedAt,
			status: {
				cpuPercent: value.status.cpuPercent,
				memPercent: value.status.memPercent,
				memUsed: value.status.memUsed,
				memTotal: value.status.memTotal,
				diskPercent: value.status.diskPercent,
				diskUsed: value.status.diskUsed,
				diskTotal: value.status.diskTotal,
			},
		};
	}
	return {
		key: value.key,
		connectionId: value.connectionId,
		name: value.name,
		username: value.username,
		host: value.host,
		port: value.port,
		state: 'failed',
		checkedAt: value.checkedAt,
		error: value.error,
	};
}

export function toPendingResource(target: SshResourceTarget, error?: ResourceFailureCode): SshResource {
	const key = resourceKey(target.host, target.port);
	if (error) {
		return {
			key,
			connectionId: target.id,
			name: target.name || target.host,
			username: target.username,
			host: target.host,
			port: target.port,
			state: 'failed',
			checkedAt: null,
			error,
		};
	}
	return {
		key,
		connectionId: target.id,
		name: target.name || target.host,
		username: target.username,
		host: target.host,
		port: target.port,
		state: 'waiting',
		checkedAt: null,
	};
}
