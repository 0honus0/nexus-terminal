export interface DockerPortBinding {
  ip?: string;
  privatePort: number;
  publicPort?: number;
  type: string;
}
export interface DockerStats {
  id: string;
  name: string;
  cpuPercent: string;
  memoryUsage: string;
  memoryPercent: string;
  networkIo: string;
  blockIo: string;
  pids: string;
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
  labels: Record<string, string> | string;
  stats?: DockerStats | null;
}
export type DockerCommand = 'start' | 'stop' | 'restart' | 'remove';
export interface DockerStatus {
  available: boolean;
  containers: DockerContainer[];
}
