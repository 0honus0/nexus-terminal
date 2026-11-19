import { z } from 'zod';

const PreferencesSchema = z
	.object({
		theme: z.enum(['light', 'dark', 'system']),
		themeId: z.string().default(''),
		locale: z.enum(['zh-CN', 'en']),
		motionEffects: z.boolean().default(true),
		animationSpeed: z.number().min(0.5).max(2).default(1.2),
		escapeAction: z.enum(['minimize', 'close']).default('minimize'),
	})
	.readonly();

/** 设置模块提交的快照携带持久版本，与 WS 的传输版本独立。 */
export const PreferencesSnapshotSchema = z.object({
	revision: z.number().int().nonnegative(),
	preferences: PreferencesSchema,
});

export type PreferencesSnapshot = z.infer<typeof PreferencesSnapshotSchema>;
