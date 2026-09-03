/**
 * TEMPORARY compatibility for the current settings UI.
 * Native number inputs are serialized by Vue as numbers, while the new Settings domain stores
 * canonical string values. Keep this coercion at the legacy HTTP edge rather than weakening the
 * SettingsService contract.
 */
export const fromLegacySettingValue = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return null;
};
