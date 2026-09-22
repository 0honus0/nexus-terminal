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

export interface RemoteResourceStatusDto {
  cpuPercent?: number;
  memPercent?: number;
  memUsed?: number;
  memTotal?: number;
  swapPercent?: number;
  swapUsed?: number;
  swapTotal?: number;
  diskPercent?: number;
  diskUsed?: number;
  diskTotal?: number;
  cpuModel?: string;
  netRxRate?: number;
  netTxRate?: number;
  netInterface?: string;
  osName?: string;
  loadAvg?: number[];
  timestamp: number;
}

export interface SshResourceStatusDto {
  key: string;
  connectionId: number;
  name: string;
  username: string;
  host: string;
  port: number;
  status?: RemoteResourceStatusDto;
  error?: string;
  checkedAt: number;
}
