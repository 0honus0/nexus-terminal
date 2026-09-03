export interface ServerStatus {
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  networkRxBytesPerSecond: number;
  networkTxBytesPerSecond: number;
}

export interface ServerStatusCollector {
  collect(sessionId: string, monitorKey: string): Promise<ServerStatus>;
}
