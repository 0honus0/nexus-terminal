import {
	readSettingsResponse,
	readSettingsUpdate,
	readSettingsCaptchaUpdate,
	readSettingsCaptchaResponse,
	readSettingsError,
} from '@nexus-terminal/shared/preferences/configuration/http-codec';
import {
	SETTINGS_REQUEST_MAX_BYTES,
	SETTINGS_RESPONSE_MAX_BYTES,
	type SettingsErrorCode,
} from '@nexus-terminal/shared/preferences/configuration/values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { dispatchUnauthorized } from '@/client/http/unauthorized';
import {
	ConfigurationFailure,
	type CoreConfiguration,
	type CaptchaDraft,
	type NetworkPolicy,
	type MonitoringDraft,
} from '../model/configuration-types';
import {
	toCoreConfiguration,
	toCaptchaCommand,
	toNetworkUpdate,
	toMonitoringUpdate,
} from '../model/configuration-mapper';

const failureStatus: Record<SettingsErrorCode, number> = {
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

async function send<T>(
	method: 'GET' | 'PUT',
	path: string,
	decode: (value: unknown) => T,
	input?: () => unknown,
	signal?: AbortSignal,
): Promise<T> {
	let body: unknown;
	try {
		body = input?.();
	} catch (cause) {
		throw new ConfigurationFailure('invalid_input', 'not_dispatched', { cause });
	}
	let response;
	try {
		response = await requestJson({
			method,
			url: '/api/v1/settings' + path,
			body,
			signal,
			maxRequestBytes: SETTINGS_REQUEST_MAX_BYTES,
			maxResponseBytes: SETTINGS_RESPONSE_MAX_BYTES,
		});
	} catch (cause) {
		if (cause instanceof HttpRequestFailure) {
			throw new ConfigurationFailure(cause.code, cause.outcome, { cause });
		}
		throw new ConfigurationFailure('request_failed', 'unknown', { cause });
	}
	if (response.status >= 400) {
		let failure;
		try {
			failure = readSettingsError(response.body);
			if (
				response.status !== failureStatus[failure.code] &&
				!(failure.code === 'invalid_input' && response.status === 415)
			) {
				throw new Error('Unexpected configuration failure status');
			}
		} catch (cause) {
			throw new ConfigurationFailure('protocol_failure', 'unknown', { cause });
		}
		const unknown = ['operation_unknown', 'storage_unavailable', 'internal_failure'].includes(failure.code);
		if (failure.code === 'unauthenticated') dispatchUnauthorized('/settings' + path);
		throw new ConfigurationFailure(failure.code, unknown ? 'unknown' : 'confirmed');
	}
	try {
		if (response.status !== 200) {
			throw new Error('Unexpected configuration response');
		}
		return decode(response.body);
	} catch (cause) {
		throw new ConfigurationFailure('protocol_failure', 'unknown', { cause });
	}
}

export const configurationApi = {
	async get(signal?: AbortSignal): Promise<CoreConfiguration> {
		return toCoreConfiguration(await send('GET', '', readSettingsResponse, undefined, signal));
	},

	async saveNetwork(
		snapshot: CoreConfiguration,
		network: NetworkPolicy,
		signal?: AbortSignal,
	): Promise<CoreConfiguration> {
		const result = await send(
			'PUT',
			'',
			readSettingsResponse,
			() => readSettingsUpdate(toNetworkUpdate(snapshot, network)),
			signal,
		);
		if (result.version !== snapshot.revision + 1) {
			throw new ConfigurationFailure('protocol_failure', 'unknown');
		}
		return toCoreConfiguration(result);
	},

	async saveMonitoring(
		snapshot: CoreConfiguration,
		draft: MonitoringDraft,
		signal?: AbortSignal,
	): Promise<CoreConfiguration> {
		const command = toMonitoringUpdate(snapshot, draft);
		const result = await send('PUT', '', readSettingsResponse, () => readSettingsUpdate(command), signal);
		if (
			result.version !== snapshot.revision + 1 ||
			result.policy.statusMonitorIntervalSeconds !== command.policy.statusMonitorIntervalSeconds ||
			result.policy.remoteHostRefreshIntervalSeconds !== command.policy.remoteHostRefreshIntervalSeconds
		) {
			throw new ConfigurationFailure('protocol_failure', 'unknown');
		}
		return toCoreConfiguration(result);
	},

	async saveCaptcha(revision: number, draft: CaptchaDraft, signal?: AbortSignal): Promise<void> {
		await send(
			'PUT',
			'/captcha',
			(value) => {
				const result = readSettingsCaptchaResponse(value);
				if (result.version !== revision + 1) {
					throw new Error('Unexpected configuration revision');
				}
				return result;
			},
			() => readSettingsCaptchaUpdate({ expectedVersion: revision, captcha: toCaptchaCommand(draft) }),
			signal,
		);
	},
};
