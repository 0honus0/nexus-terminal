import type { DockerCommand, DockerStats, DockerStatus } from '../model/docker';
export interface DockerChannel {
  getStatus(): Promise<DockerStatus>;
  command(containerId: string, command: DockerCommand): Promise<void>;
  getStats(containerId: string): Promise<DockerStats | null>;
}
