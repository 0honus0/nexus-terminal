import type { LocalSystemStatus } from '@nexus-terminal/shared/system/status/model';
import type { SshResourceStatus } from '@nexus-terminal/shared/remote/monitoring/model';
import type { LocalResourceStatus, SshResource, SshResourceTarget, ResourceFailureCode } from './system-overview-types';

export function toLocalResource(value: LocalSystemStatus, checkedAt: number): LocalResourceStatus {
	return {
		cpuPercent: value.cpuPercent,
		memPercent: value.memPercent,
		memUsed: value.memUsed,
		memTotal: value.memTotal,
		diskPercent: value.diskPercent,
		diskUsed: value.diskUsed,
		diskTotal: value.diskTotal,
		checkedAt,
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

export function toRetainedResource(target: SshResourceTarget, previous?: SshResource): SshResource {
	if (!previous) {
		return toPendingResource(target);
	}
	const key = resourceKey(target.host, target.port);
	const connectionId = target.id;
	const name = target.name || target.host;
	const username = target.username;
	const host = target.host;
	const port = target.port;
	if (previous.state === 'ready') {
		return {
			key,
			connectionId,
			name,
			username,
			host,
			port,
			state: 'ready',
			checkedAt: previous.checkedAt,
			status: previous.status,
			refreshError: previous.refreshError,
		};
	}
	if (previous.state === 'failed') {
		return {
			key,
			connectionId,
			name,
			username,
			host,
			port,
			state: 'failed',
			checkedAt: previous.checkedAt,
			error: previous.error,
		};
	}
	return {
		key,
		connectionId,
		name,
		username,
		host,
		port,
		state: 'waiting',
		checkedAt: null,
	};
}

export function toRefreshFailureResource(
	target: SshResourceTarget,
	previous: SshResource | undefined,
	error: ResourceFailureCode,
): SshResource {
	if (previous?.state !== 'ready') {
		return toPendingResource(target, error);
	}
	return {
		key: resourceKey(target.host, target.port),
		connectionId: target.id,
		name: target.name || target.host,
		username: target.username,
		host: target.host,
		port: target.port,
		state: 'ready',
		checkedAt: previous.checkedAt,
		status: previous.status,
		refreshError: error,
	};
}
