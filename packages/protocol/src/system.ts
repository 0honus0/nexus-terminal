export interface ResourceStatusDto {
  cpuPercent: number;
  memPercent: number;
  memUsed: number;
  memTotal: number;
  diskPercent?: number;
  diskUsed?: number;
  diskTotal?: number;
  cpuModel?: string;
  osName?: string;
  uptimeSeconds: number;
}

export interface SshResourceStatusDto {
  key: string;
  connectionId: number;
  name: string;
  username: string;
  host: string;
  port: number;
  status?: ResourceStatusDto;
  error?: string;
  checkedAt: number;
}
