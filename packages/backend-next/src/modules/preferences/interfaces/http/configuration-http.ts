import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { AccessCaptchaConfigResponse } from '@nexus-terminal/shared/access/http';
import type { SettingsPolicy, SettingsView } from '@nexus-terminal/shared/preferences/configuration/model';
import type {
	SettingsCaptchaCommand,
	SettingsCaptchaResponse,
	SettingsSecretCommand,
} from '@nexus-terminal/shared/preferences/configuration/http';
import {
	readSettingsUpdate,
	readSettingsCaptchaUpdate,
	InvalidSettingsPayload,
} from '@nexus-terminal/shared/preferences/configuration/http-codec';
import {
	type SettingsErrorCode,
	SETTINGS_REQUEST_MAX_BYTES,
	SETTINGS_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/configuration/values';
import type { ConfigurationService } from '../../configuration/service/configuration-service.js';
import type {
	ConfigurationPolicy,
	ConfigurationView,
	ConfigurationCaptchaInput,
	ConfigurationSecret,
} from '../../configuration/model/configuration-types.js';
import { PreferencesFailure } from '../../preferences-failure.js';

function toPolicy(value: SettingsPolicy): ConfigurationPolicy {
	return {
		ipWhitelist: value.ipWhitelist,
		ipBlacklistEnabled: value.ipBlacklistEnabled,
		maxLoginAttempts: value.maxLoginAttempts,
		loginBanDuration: value.loginBanDuration,
		statusMonitorIntervalSeconds: value.statusMonitorIntervalSeconds,
		remoteHostRefreshIntervalSeconds: value.remoteHostRefreshIntervalSeconds,
		passkeys: value.passkeys.map((site) => ({ origin: site.origin, rpId: site.rpId })),
	};
}

function toSecret(value: SettingsSecretCommand): ConfigurationSecret {
	return value.action === 'replace' ? { action: 'replace', value: value.value } : { action: value.action };
}

function toCaptcha(value: SettingsCaptchaCommand): ConfigurationCaptchaInput {
	return {
		enabled: value.enabled,
		provider: value.provider,
		siteKey: value.siteKey,
		expectedHostname: value.expectedHostname,
		secret: toSecret(value.secret),
	};
}

function toWire(value: ConfigurationView): SettingsView {
	const record = value.current;
	return {
		version: record.version,
		effectiveVersion: value.effectiveVersion,
		requiresRestart: record.version !== value.effectiveVersion,
		policy: {
			ipWhitelist: record.policy.ipWhitelist,
			ipBlacklistEnabled: record.policy.ipBlacklistEnabled,
			maxLoginAttempts: record.policy.maxLoginAttempts,
			loginBanDuration: record.policy.loginBanDuration,
			statusMonitorIntervalSeconds: record.policy.statusMonitorIntervalSeconds,
			remoteHostRefreshIntervalSeconds: record.policy.remoteHostRefreshIntervalSeconds,
			passkeys: record.policy.passkeys.map((site) => ({ origin: site.origin, rpId: site.rpId })),
		},
		captcha: {
			enabled: record.captcha.enabled,
			provider: record.captcha.provider,
			siteKey: record.captcha.siteKey,
			hasSecret: record.captcha.secretKey.length > 0,
			expectedHostname: record.captcha.expectedHostname,
		},
	};
}

async function authorize(context: HttpRouteContext, access: AccessPublicApi): Promise<string> {
	const token = context.cookie(ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (!identity || !token) {
		throw new PreferencesFailure('unauthenticated');
	}
	if (identity.userId !== 1) {
		throw new PreferencesFailure('forbidden');
	}
	return token;
}

function send(context: HttpRouteContext, body: unknown): void {
	if (Buffer.byteLength(JSON.stringify(body), 'utf8') > SETTINGS_RESPONSE_MAX_BYTES) {
		throw new PreferencesFailure('limit_exceeded');
	}
	context.send(200, body);
}

const ERROR_STATUS: Record<SettingsErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	version_conflict: 409,
	limit_exceeded: 413,
	storage_unavailable: 503,
	operation_unknown: 503,
	internal_failure: 503,
	unavailable: 503,
};

function failureCode(error: unknown): SettingsErrorCode {
	if (error instanceof HttpInputFailure) {
		return error.status === 413 ? 'limit_exceeded' : 'invalid_input';
	}
	if (error instanceof InvalidSettingsPayload) {
		return 'invalid_input';
	}
	if (error instanceof PreferencesFailure) {
		return error.code;
	}
	if (
		error instanceof AccessOperationError &&
		(error.code === 'storage_unavailable' || error.code === 'operation_unknown')
	) {
		return error.code;
	}
	return 'internal_failure';
}

async function handle(context: HttpRouteContext, work: () => Promise<void>): Promise<void> {
	try {
		if (context.query.size) {
			throw new InvalidSettingsPayload();
		}
		await work();
	} catch (error) {
		const code = failureCode(error);
		const status = error instanceof HttpInputFailure ? error.status : ERROR_STATUS[code];
		context.send(status, { code });
	}
}

async function deliverMutation(
	context: HttpRouteContext,
	access: AccessPublicApi,
	view: ConfigurationView,
	captchaOnly: boolean,
): Promise<void> {
	try {
		await authorize(context, access);
		if (context.response.destroyed || context.response.writableEnded) {
			throw new PreferencesFailure('operation_unknown');
		}
		const wire = toWire(view);
		if (captchaOnly) {
			const body: SettingsCaptchaResponse = {
				version: wire.version,
				effectiveVersion: wire.effectiveVersion,
				requiresRestart: wire.requiresRestart,
				captcha: {
					enabled: wire.captcha.enabled,
					provider: wire.captcha.provider,
					siteKey: wire.captcha.siteKey,
					hasSecret: wire.captcha.hasSecret,
					expectedHostname: wire.captcha.expectedHostname,
				},
			};
			send(context, body);
		} else {
			send(context, wire);
		}
	} catch (cause) {
		throw new PreferencesFailure('operation_unknown', { cause });
	}
}

export function createConfigurationRoutes(service: ConfigurationService, access: AccessPublicApi): HttpRoute[] {
	return [
		{
			method: 'GET',
			path: '/api/v1/settings',

			handle: (context) =>
				handle(context, async () => {
					await authorize(context, access);
					const view = await service.get();
					await authorize(context, access);
					send(context, toWire(view));
				}),
		},
		{
			method: 'PUT',
			path: '/api/v1/settings',
			maxBodyBytes: SETTINGS_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					await authorize(context, access);
					const command = readSettingsUpdate(await context.json());
					const token = await authorize(context, access);
					if (context.response.destroyed || context.response.writableEnded) {
						throw new PreferencesFailure('unavailable');
					}
					const view = await service.update(
						{
							expectedVersion: command.expectedVersion,
							policy: toPolicy(command.policy),
							captcha: toCaptcha(command.captcha),
						},
						token,
					);
					await deliverMutation(context, access, view, false);
				}),
		},
		{
			method: 'GET',
			path: '/api/v1/settings/captcha',

			handle: (context) =>
				handle(context, async () => {
					const value = service.installation().captcha;
					const body: AccessCaptchaConfigResponse = {
						enabled: value.enabled,
						provider: value.provider,
						hcaptchaSiteKey: value.provider === 'hcaptcha' ? value.siteKey : '',
						recaptchaSiteKey: value.provider === 'recaptcha' ? value.siteKey : '',
					};
					send(context, body);
				}),
		},
		{
			method: 'PUT',
			path: '/api/v1/settings/captcha',
			maxBodyBytes: SETTINGS_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					await authorize(context, access);
					const command = readSettingsCaptchaUpdate(await context.json());
					const token = await authorize(context, access);
					if (context.response.destroyed || context.response.writableEnded) {
						throw new PreferencesFailure('unavailable');
					}
					const view = await service.updateCaptcha(
						{
							expectedVersion: command.expectedVersion,
							captcha: toCaptcha(command.captcha),
						},
						token,
					);
					await deliverMutation(context, access, view, true);
				}),
		},
	];
}
