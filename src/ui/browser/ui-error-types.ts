import { z } from 'zod';

/** Module-owned stable codes. Upstream errors retain their original code in ErrorDetail. */
export const UiErrorCodeSchema = z.enum([
	'UI_THEME_DUPLICATE',
	'UI_THEME_INVALID_TOKEN',
	'UI_THEME_NOT_INSTALLED',
	'UI_THEME_UNAVAILABLE',
]);

export type UiErrorCode = z.infer<typeof UiErrorCodeSchema>;

export const UiErrorCode = UiErrorCodeSchema.enum;
