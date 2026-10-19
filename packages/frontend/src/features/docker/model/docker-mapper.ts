import type {
	WorkspaceDockerContainer,
	WorkspaceDockerStats,
	WorkspaceDockerStatus,
} from '@nexus-terminal/shared/remote/docker/workspace';
import type { DockerContainer, DockerStats, DockerStatus } from './docker-types';

export function toDockerStats(value: WorkspaceDockerStats | null): DockerStats | null {
	if (value === null) {
		return null;
	}
	return {
		id: value.id,
		name: value.name,
		cpuPercent: value.cpuPercent,
		memoryUsage: value.memoryUsage,
		memoryPercent: value.memoryPercent,
		networkIo: value.networkIo,
		blockIo: value.blockIo,
		pids: value.pids,
	};
}

function toContainer(value: WorkspaceDockerContainer): DockerContainer {
	return {
		id: value.id,
		names: value.names.map((name) => name),
		image: value.image,
		imageId: value.imageId,
		command: value.command,
		created: value.created,
		state: value.state,
		status: value.status,
		ports: value.ports.map((port) => ({
			ip: port.ip,
			privatePort: port.privatePort,
			publicPort: port.publicPort,
			type: port.type,
		})),
		labels:
			typeof value.labels === 'string'
				? value.labels
				: Object.fromEntries(Object.entries(value.labels).map(([key, label]) => [key, label])),
		stats: value.stats === undefined ? undefined : toDockerStats(value.stats),
	};
}

export function toDockerStatus(value: WorkspaceDockerStatus): DockerStatus {
	return { available: value.available, containers: value.containers.map(toContainer) };
}
