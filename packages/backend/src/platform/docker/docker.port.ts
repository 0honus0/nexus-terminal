export type DockerCommand = 'start' | 'stop' | 'restart' | 'remove';

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export interface DockerCapability {
  list(): Promise<DockerContainerSummary[]>;
  command(containerId: string, command: DockerCommand): Promise<void>;
}
