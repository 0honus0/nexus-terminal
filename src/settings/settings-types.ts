import { z } from 'zod';

export const AnimationSpeedSchema = z.number().min(0.5).max(2);

export const DesktopWallpaperSchema = z.enum(['silk', 'grid', 'dunes', 'minimal']);

export type DesktopWallpaper = z.infer<typeof DesktopWallpaperSchema>;

export const SettingsPreferencesSchema = z.strictObject({
	locale: z.enum(['en', 'zh']),
	theme: z.enum(['system', 'light', 'dark']),
	themeId: z.string().max(512),
	wallpaper: DesktopWallpaperSchema,
	motionEffects: z.boolean(),
	animationSpeed: AnimationSpeedSchema,
	escapeAction: z.enum(['minimize', 'close']),
});

export type SettingsPreferences = z.infer<typeof SettingsPreferencesSchema>;

export const SettingsPatchSchema = SettingsPreferencesSchema.partial();

export const SettingsSnapshotSchema = z.strictObject({
	preferences: SettingsPreferencesSchema,
	revision: z.int().nonnegative(),
});

export type SettingsSnapshot = z.infer<typeof SettingsSnapshotSchema>;

export const defaultSettings: SettingsPreferences = Object.freeze({
	locale: 'en',
	theme: 'system',
	themeId: '',
	wallpaper: 'silk',
	motionEffects: true,
	animationSpeed: 1.2,
	escapeAction: 'minimize',
});

export const SettingsPluginId = '@nexus-terminal/settings';

export const SettingsTopic = { pluginId: SettingsPluginId, name: 'preferences' } as const;
