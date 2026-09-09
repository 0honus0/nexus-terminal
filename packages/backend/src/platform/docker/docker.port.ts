export interface DockerPortInfo {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
}
export interface DockerStats {
  ID: string;
  Name: string;
  CPUPerc: string;
  MemUsage: string;
  MemPerc: string;
  NetIO: string;
  BlockIO: string;
  PIDs: string;
}
export interface DockerContainer {
  id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  Command: string;
  Created: number | string;
  State: string;
  Status: string;
  Ports: DockerPortInfo[];
  Labels: Record<string, string> | string;
  stats?: DockerStats | null;
}
export type DockerCommand = 'start' | 'stop' | 'restart' | 'remove';
export interface DockerStatus {
  available: boolean;
  containers: DockerContainer[];
}
