export type { WorkspaceStatusSampleDto as ServerStatusSample } from '@nexus-terminal/protocol/workspace';

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
