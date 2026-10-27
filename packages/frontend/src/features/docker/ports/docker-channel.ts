import type { DockerAction, DockerStats, DockerStatus } from '../model/docker-types';

export interface DockerChannel {
	getStatus(): Promise<DockerStatus>;
	command(containerId: string, command: DockerAction): Promise<void>;
	getStats(containerId: string): Promise<DockerStats | null>;
}
