import type { DockerAction } from './values.js';

export interface WorkspaceDockerPortBinding {
	ip?: string;
	privatePort: number;
	publicPort?: number;
	type: string;
}

export interface WorkspaceDockerStats {
	id: string;
	name: string;
	cpuPercent: string;
	memoryUsage: string;
	memoryPercent: string;
	networkIo: string;
	blockIo: string;
	pids: string;
}

export interface WorkspaceDockerContainer {
	id: string;
	names: string[];
	image: string;
	imageId: string;
	command: string;
	created: number | string;
	state: string;
	status: string;
	ports: WorkspaceDockerPortBinding[];
	labels: Record<string, string> | string;
	stats?: WorkspaceDockerStats | null;
}

export type WorkspaceDockerCommand = DockerAction;

export interface WorkspaceDockerStatus {
	available: boolean;
	containers: WorkspaceDockerContainer[];
}

export interface WorkspaceDockerCommandRequest {
	containerId: string;
	command: WorkspaceDockerCommand;
}

export interface WorkspaceDockerStatsRequest {
	containerId: string;
}

export interface WorkspaceDockerRequests {
	'docker.status': Record<string, never>;
	'docker.stats': WorkspaceDockerStatsRequest;
	'docker.command': WorkspaceDockerCommandRequest;
}

export interface WorkspaceDockerResponses {
	'docker.status': WorkspaceDockerStatus;
	'docker.stats': WorkspaceDockerStats | null;
	'docker.command': null;
}
