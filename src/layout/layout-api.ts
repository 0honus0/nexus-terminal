import { z } from 'zod';

/** 全项目统一的可用空间分档，不表示设备型号、操作系统或输入方式。宽度单位为 CSS 像素。 */
export const LayoutProfileSchema = z.enum(['compact', 'wide']);

export type LayoutProfile = z.infer<typeof LayoutProfileSchema>;

/** 分档阈值只在此维护；触摸/鼠标按实际 PointerEvent 判断，不从尺寸推断。 */
export const LayoutProfiles = {
	compact: { minWidth: 0, columns: 4 },
	wide: { minWidth: 700, columns: 12 },
} as const satisfies Record<LayoutProfile, { minWidth: number; columns: number }>;

export function resolveLayoutProfile(width: number): LayoutProfile {
	return width >= LayoutProfiles.wide.minWidth ? 'wide' : 'compact';
}
