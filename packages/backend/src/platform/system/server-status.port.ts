import type { ExecutionSession } from '../execution/execution-session';

export interface ServerStatus {
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

export interface ServerStatusCollector {
  collect(session: ExecutionSession, monitorKey: string): Promise<ServerStatus>;
  clear(monitorKey: string): void;
}
