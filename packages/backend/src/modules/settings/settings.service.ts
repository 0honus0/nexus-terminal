export interface SettingsSnapshot {
  language: string;
  timezone: string;
  statusMonitorIntervalSeconds: number;
  remoteHostRefreshIntervalSeconds: number;
}

export interface SettingsService {
  get(): Promise<SettingsSnapshot>;
  update(input: Partial<SettingsSnapshot>): Promise<SettingsSnapshot>;
}
