import { z } from 'zod';

export const authStatePath = '/auth/state';

export const authInitializePath = '/auth/initialize';

export const authLoginPath = '/auth/login';

export const authLogoutPath = '/auth/logout';

export const authPasswordPath = '/auth/password';

export const AuthAccountSchema = z.object({ id: z.literal('owner'), username: z.string().min(1) });

export type AuthAccount = z.infer<typeof AuthAccountSchema>;

export const AuthCredentialsSchema = z.strictObject({ username: z.string().min(1), password: z.string().min(1) });

export type AuthCredentials = z.infer<typeof AuthCredentialsSchema>;

export const AuthChangePasswordSchema = z.strictObject({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(1),
});

export type AuthChangePassword = z.infer<typeof AuthChangePasswordSchema>;

export const AuthMethodSchema = z.object({
	pluginId: z.string().min(1).nullable(),
	id: z.string().min(1),
	label: z.string().min(1),
	baseURL: z.string().min(1),
});

export type AuthMethod = z.infer<typeof AuthMethodSchema>;

export const AuthStateSchema = z.object({
	initialized: z.boolean(),
	account: AuthAccountSchema.nullable(),
	methods: z.array(AuthMethodSchema),
});

export type AuthState = z.infer<typeof AuthStateSchema>;
