export interface SettingRecord {
  key: string;
  value: string;
}
export interface SettingsRepository {
  list(): Promise<SettingRecord[]>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  setMany(values: Record<string, string>): Promise<void>;
  delete(key: string): Promise<boolean>;
}
