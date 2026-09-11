export interface HardLimitUsageSnapshot {
  artifactUsedBytes: number;
  artifactReservedBytes: number;
  executingRuntimes: number;
  activeWorkspaces: number;
}

export interface HardLimitUsagePort {
  read(userId: number): Promise<HardLimitUsageSnapshot>;
}
