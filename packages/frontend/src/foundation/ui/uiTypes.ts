export type UiDensity = 'compact' | 'default' | 'comfortable' | 'touch';
export type UiTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
export type UiAppearance = 'solid' | 'soft' | 'ghost' | 'glass';
export type UiSurfaceKind = 'plain' | 'raised' | 'inset' | 'glass';

export type UiSelectValue = string | number | null;

export interface UiSelectOption {
	value: UiSelectValue;
	label: string;
	triggerLabel?: string;
	description?: string;
	disabled?: boolean;
}
