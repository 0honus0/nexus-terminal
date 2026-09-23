export type UiDensity = 'compact' | 'default' | 'comfortable';
export type UiTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
export type UiAppearance = 'solid' | 'soft' | 'ghost' | 'glass';
export type UiSurfaceKind = 'plain' | 'raised' | 'inset' | 'glass';

export type UiSelectValue = string | number;

export interface UiSelectOption {
  value: UiSelectValue;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface UiComboboxOption {
  value: UiSelectValue;
  label: string;
  description?: string;
  keywords?: string;
  disabled?: boolean;
}
