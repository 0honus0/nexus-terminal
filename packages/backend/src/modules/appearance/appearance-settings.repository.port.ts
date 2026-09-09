export interface AppearanceSettingRow {
  key: string;
  value: string;
  updatedAt: number;
}

export interface AppearanceSettingsRepository {
  list(): Promise<AppearanceSettingRow[]>;
  ensure(values: Readonly<Record<string, string>>): Promise<void>;
  setMany(values: Readonly<Record<string, string>>): Promise<boolean>;
}
