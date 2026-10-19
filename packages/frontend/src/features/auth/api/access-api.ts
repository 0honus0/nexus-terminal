import {
	readAccessLogin,
	readAccessLogout,
	readAccessNeedsSetup,
	readAccessSetup,
	readAccessStatus,
	readAccessSetupRequest,
	readAccessLoginRequest,
	readAccessCaptchaConfig,
	readAccessPasswordRequest,
	readAccessPassword,
	type AccessPasswordRequest,
	type AccessPasswordResponse,
	type AccessLoginRequest,
	type AccessSetupRequest,
	type AccessSetupResponse,
	type AccessPasswordLoginResponse,
	type AccessStatusResponse,
	type AccessLogoutResponse,
	type AccessCaptchaConfigResponse,
} from '@nexus-terminal/shared/access/http';
import { ACCESS_TOTP_SETUP_RESPONSE_MAX_BYTES } from '@nexus-terminal/shared/access/values';
import {
	readTotpToken,
	readTotpDisable,
	type AccessTotpLoginResponse,
	type AccessTotpSetupResponse,
	type AccessTotpChangedResponse,
} from '@nexus-terminal/shared/access/factors/http';
import {
	readAccessTotpLogin,
	readAccessTotpSetup,
	readAccessTotpChanged,
} from '@nexus-terminal/shared/access/factors/http-codec';
import { AuthRequestFailure } from '../model/auth-failure';
import { createAccessRequest } from './access-request';
import { createPasskeyApi, type PasskeyApi } from './passkey-api';

export interface AccessApi {
	readonly passkeys: PasskeyApi;
	changePassword(input: AccessPasswordRequest, signal?: AbortSignal): Promise<AccessPasswordResponse>;
	beginTotpSetup(signal?: AbortSignal): Promise<AccessTotpSetupResponse>;
	activateTotp(token: string, signal?: AbortSignal): Promise<AccessTotpChangedResponse>;
	disableTotp(password: string, signal?: AbortSignal): Promise<AccessTotpChangedResponse>;
	needsSetup(signal?: AbortSignal): Promise<boolean>;
	setup(input: AccessSetupRequest, signal?: AbortSignal): Promise<AccessSetupResponse>;
	login(input: AccessLoginRequest, signal?: AbortSignal): Promise<AccessPasswordLoginResponse>;
	status(signal?: AbortSignal): Promise<AccessStatusResponse | null>;
	logout(signal?: AbortSignal): Promise<AccessLogoutResponse>;
	verifyTwoFactor(token: string, signal?: AbortSignal): Promise<AccessTotpLoginResponse>;
	captchaConfig(signal?: AbortSignal): Promise<AccessCaptchaConfigResponse>;
}

/** Shared wire owner for the formal application and isolated DEV consumers. */
export function createAccessApi(basePath = '/api/v1/auth'): AccessApi {
	const send = createAccessRequest(basePath);
	return {
		passkeys: createPasskeyApi(send),

		changePassword: (input, signal) =>
			send({
				method: 'PUT',
				path: '/password',
				status: 200,
				decode: readAccessPassword,

				input: () =>
					readAccessPasswordRequest({
						currentPassword: input.currentPassword,
						newPassword: input.newPassword,
					}),

				signal,
			}),

		beginTotpSetup: (signal) =>
			send({
				method: 'POST',
				path: '/2fa/setup',
				status: 200,
				decode: readAccessTotpSetup,

				input: () => ({}),

				signal,
				maxResponseBytes: ACCESS_TOTP_SETUP_RESPONSE_MAX_BYTES,
			}),

		activateTotp: (token, signal) =>
			send({
				method: 'POST',
				path: '/2fa/verify',
				status: 200,
				decode: readAccessTotpChanged,

				input: () => ({ token: readTotpToken({ token }) }),

				signal,
			}),

		disableTotp: (password, signal) =>
			send({
				method: 'DELETE',
				path: '/2fa',
				status: 200,
				decode: readAccessTotpChanged,

				input: () => ({ password: readTotpDisable({ password }) }),

				signal,
			}),

		needsSetup: async (signal) =>
			(await send({ method: 'GET', path: '/needs-setup', status: 200, decode: readAccessNeedsSetup, signal }))
				.needsSetup,

		setup: (input, signal) =>
			send({
				method: 'POST',
				path: '/setup',
				status: 201,
				decode: readAccessSetup,

				input: () =>
					readAccessSetupRequest({
						username: input.username,
						password: input.password,
						confirmPassword: input.confirmPassword,
					}),

				signal,
			}),

		login: (input, signal) =>
			send({
				method: 'POST',
				path: '/login',
				status: 200,
				decode: readAccessLogin,

				input: () =>
					readAccessLoginRequest({
						username: input.username,
						password: input.password,
						rememberMe: input.rememberMe,
						captchaToken: input.captchaToken,
					}),

				signal,
			}),

		async status(signal) {
			try {
				return await send({ method: 'GET', path: '/status', status: 200, decode: readAccessStatus, signal });
			} catch (cause) {
				if (cause instanceof AuthRequestFailure && cause.status === 401 && cause.code === 'unauthenticated') {
					return null;
				}
				throw cause;
			}
		},

		logout: (signal) =>
			send({
				method: 'POST',
				path: '/logout',
				status: 200,
				decode: readAccessLogout,

				input: () => ({}),

				signal,
			}),

		verifyTwoFactor: (token, signal) =>
			send({
				method: 'POST',
				path: '/login/2fa',
				status: 200,
				decode: readAccessTotpLogin,

				input: () => ({ token: readTotpToken({ token }) }),

				signal,
			}),

		captchaConfig: (signal) =>
			send({ method: 'GET', path: '/captcha/config', status: 200, decode: readAccessCaptchaConfig, signal }),
	};
}
