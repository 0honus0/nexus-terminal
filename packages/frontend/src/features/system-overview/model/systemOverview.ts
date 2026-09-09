export interface ResourceStatus {
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
export interface SshResourceStatus {
  key: string;
  connectionId: number;
  name: string;
  username: string;
  host: string;
  port: number;
  status?: ResourceStatus;
  error?: string;
  checkedAt: number;
}
