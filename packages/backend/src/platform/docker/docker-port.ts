import type { MachineCommandExecutor } from '../ssh/ssh-port.js';
import type { DockerAction } from '@nexus-terminal/shared/remote/docker/values';

/** The native and wire actions share only this finite value, never DTOs or application owners. */
export type { DockerAction } from '@nexus-terminal/shared/remote/docker/values';

export interface DockerPortBinding {
	ip?: string;
	privatePort: number;
	publicPort?: number;
	protocol: string;
}

export interface DockerStats {
	id: string;
	name: string;
	cpuPercent: string;
	memoryUsage: string;
	memoryPercent: string;
	networkIO: string;
	blockIO: string;
	processes: string;
}

export interface DockerContainer {
	id: string;
	names: string[];
	image: string;
	imageId: string;
	command: string;
	created: number | string;
	state: string;
	status: string;
	ports: DockerPortBinding[];
	labels: string;
	stats: DockerStats | null;
}

export interface DockerStatus {
	available: boolean;
	containers: DockerContainer[];
}

export interface DockerPort {
	status(execute: MachineCommandExecutor, signal: AbortSignal): Promise<DockerStatus>;
	stats(execute: MachineCommandExecutor, id: string, signal: AbortSignal): Promise<DockerStats | null>;
	command(execute: MachineCommandExecutor, id: string, action: DockerAction, signal: AbortSignal): Promise<void>;
}

export class DockerFailure extends Error {
	constructor(
		readonly reason: 'failed' | 'unknown' | 'invalid_output',
		options?: ErrorOptions,
	) {
		super('Docker ' + reason, options);
	}
}
