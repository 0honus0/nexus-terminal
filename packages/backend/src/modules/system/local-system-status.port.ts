export interface LocalSystemStatus {
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
export interface LocalSystemStatusProvider {
  collect(): Promise<LocalSystemStatus>;
}
