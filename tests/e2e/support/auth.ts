import { expect, type APIRequestContext } from '@playwright/test';
import {
	readAccessNeedsSetup,
	readAccessSetup,
	readAccessLogin,
	readAccessStatus,
} from '../../../packages/shared/src/access/http';
import {
	readPreferencesResponse,
	readPreferencesUpdate,
	readPresentationUpdateResponse,
} from '../../../packages/shared/src/preferences/presentation/http-codec';
import { PREFERENCE_LANGUAGES } from '../../../packages/shared/src/preferences/presentation/values';
import type { PresentationPreferences } from '../../../packages/shared/src/preferences/presentation/model';
import type { PreferencesResponse } from '../../../packages/shared/src/preferences/presentation/http';
import { E2E_ADMIN } from './test-identity';
import { E2E_URLS } from './test-env';

export { E2E_ADMIN } from './test-identity';

export async function ensureInitialAdmin(request: APIRequestContext): Promise<void> {
	const response = await request.get('/api/v1/auth/needs-setup');
	expect(response.ok()).toBeTruthy();
	if (!readAccessNeedsSetup(await response.json()).needsSetup) return;
	const setup = await request.post('/api/v1/auth/setup', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: {
			username: E2E_ADMIN.username,
			password: E2E_ADMIN.password,
			confirmPassword: E2E_ADMIN.password,
		},
	});
	expect(setup.status()).toBe(201);
	expect(readAccessSetup(await setup.json()).user.username).toBe(E2E_ADMIN.username);
}

export async function loginAsInitialAdmin(request: APIRequestContext): Promise<void> {
	const response = await request.post('/api/v1/auth/login', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password, rememberMe: false },
	});
	expect(response.ok()).toBeTruthy();
	const login = readAccessLogin(await response.json());
	expect(login.requiresTwoFactor).toBe(false);
	const status = await request.get('/api/v1/auth/status');
	expect(status.ok()).toBeTruthy();
	expect(readAccessStatus(await status.json()).user.username).toBe(E2E_ADMIN.username);
}

export async function setUiLanguage(request: APIRequestContext, language = 'en-US'): Promise<void> {
	const selected = PREFERENCE_LANGUAGES.find((value) => value === language);
	if (!selected) throw new Error('Unsupported E2E UI language');
	await updateUiPreferences(request, (preferences) => {
		preferences.language = selected;
	});
}

export async function updateUiPreferences(
	request: APIRequestContext,
	change: (preferences: PresentationPreferences) => void,
): Promise<void> {
	const current = await getUiPreferences(request);
	const input = readPreferencesUpdate({
		expectedVersion: current.version,
		preferences: current.preferences,
	});
	change(input.preferences);
	const saved = await request.put('/api/v1/settings/preferences', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: input,
	});
	expect(saved.ok()).toBeTruthy();
	expect(readPresentationUpdateResponse(await saved.json()).version).toBe(current.version + 1);
}

export async function getUiPreferences(request: APIRequestContext): Promise<PreferencesResponse> {
	const response = await request.get('/api/v1/settings/preferences');
	expect(response.ok()).toBeTruthy();
	return readPreferencesResponse(await response.json());
}
