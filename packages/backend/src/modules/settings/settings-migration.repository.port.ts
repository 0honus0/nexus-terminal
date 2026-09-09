export interface SettingsMigrationPatch {
  set?: Readonly<Record<string, string>>;
  remove?: readonly string[];
}

export interface SettingsMigrationRepository {
  getCurrentVersion(): Promise<number>;
  apply(version: number, name: string, patch: SettingsMigrationPatch): Promise<void>;
}
