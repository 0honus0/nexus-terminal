export interface ServerStatusSample {
  cpuPercent?: number;
  memPercent?: number;
  /** Memory values are mebibytes (MiB) from the Backend status collector. */
  memUsed?: number;
  memTotal?: number;
  swapPercent?: number;
  /** Swap values are mebibytes (MiB) from the Backend status collector. */
  swapUsed?: number;
  swapTotal?: number;
  diskPercent?: number;
  /** Disk values are kibibytes (KiB), matching `df -k`. */
  diskUsed?: number;
  diskTotal?: number;
  cpuModel?: string;
  /** Network rates are bytes per second. */
  netRxRate?: number;
  netTxRate?: number;
  netInterface?: string;
  osName?: string;
  loadAvg?: number[];
  timestamp: number;
}

export interface StatusHistoryPoint {
  time: number;
  value: number;
  sequence: number;
}

export interface StatusHistory {
  cpu: StatusHistoryPoint[];
  memory: StatusHistoryPoint[];
  swap: StatusHistoryPoint[];
  disk: StatusHistoryPoint[];
  networkRx: StatusHistoryPoint[];
  networkTx: StatusHistoryPoint[];
}
