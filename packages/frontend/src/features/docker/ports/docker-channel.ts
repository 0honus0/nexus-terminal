import type { WorkspaceDockerCommandDto, WorkspaceDockerStatsDto, WorkspaceDockerStatusDto } from '../model/docker';
export interface DockerChannel {
  getStatus(): Promise<WorkspaceDockerStatusDto>;
  command(containerId: string, command: WorkspaceDockerCommandDto): Promise<void>;
  getStats(containerId: string): Promise<WorkspaceDockerStatsDto | null>;
}
