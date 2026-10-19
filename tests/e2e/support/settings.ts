import { expect, type APIRequestContext } from '@playwright/test';
import type { SettingsView } from '../../../packages/shared/src/preferences/configuration/model';
import type {
	SettingsUpdateRequest,
	SettingsCaptchaCommand,
	SettingsCaptchaResponse,
} from '../../../packages/shared/src/preferences/configuration/http';
import {
	readSettingsResponse,
	readSettingsUpdate,
	readSettingsCaptchaResponse,
	readSettingsCaptchaUpdate,
} from '../../../packages/shared/src/preferences/configuration/http-codec';
import { E2E_URLS } from './test-env';

const headers = { Origin: E2E_URLS.frontendOrigin };

export async function getTestSettings(request: APIRequestContext): Promise<SettingsView> {
	const response = await request.get('/api/v1/settings');
	expect(response.ok()).toBe(true);
	return readSettingsResponse(await response.json());
}

export async function updateTestSettings(
	request: APIRequestContext,
	change: (input: SettingsUpdateRequest) => void,
): Promise<SettingsView> {
	const current = await getTestSettings(request);
	const input = readSettingsUpdate({
		expectedVersion: current.version,
		policy: current.policy,
		captcha: {
			enabled: current.captcha.enabled,
			provider: current.captcha.provider,
			siteKey: current.captcha.siteKey,
			expectedHostname: current.captcha.expectedHostname,
			secret: { action: 'keep' },
		},
	});
	change(input);
	const response = await request.put('/api/v1/settings', { headers, data: readSettingsUpdate(input) });
	expect(response.ok()).toBe(true);
	const saved = readSettingsResponse(await response.json());
	expect(saved.version).toBe(current.version + 1);
	return saved;
}

export async function updateTestCaptcha(
	request: APIRequestContext,
	captcha: SettingsCaptchaCommand,
): Promise<SettingsCaptchaResponse> {
	const current = await getTestSettings(request);
	const response = await request.put('/api/v1/settings/captcha', {
		headers,
		data: readSettingsCaptchaUpdate({ expectedVersion: current.version, captcha }),
	});
	expect(response.ok()).toBe(true);
	const saved = readSettingsCaptchaResponse(await response.json());
	expect(saved.version).toBe(current.version + 1);
	return saved;
}

/** Activate durable configuration through the existing isolated control plane, without replacing data. */
export async function restartTestBackend(): Promise<void> {
	const token = process.env.NEXUS_E2E_CONTROL_TOKEN;
	if (!token) throw new Error('NEXUS_E2E_CONTROL_TOKEN is required');
	const response = await fetch(E2E_URLS.backendControlOrigin + '/restart', {
		method: 'POST',
		headers: { 'X-Nexus-E2E-Control': token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ mode: 'restart' }),
		signal: AbortSignal.timeout(60_000),
	});
	expect(response.ok, 'Isolated backend restart failed: HTTP ' + response.status).toBe(true);
	expect(await response.json()).toEqual({ reset: true, mode: 'restart' });
}
