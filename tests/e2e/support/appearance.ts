import { expect, type APIRequestContext } from '@playwright/test';
import {
	readAppearanceUpdate,
	readAppearanceView,
} from '../../../packages/shared/src/preferences/appearance/http-codec';
import type { AppearanceUpdateRequest } from '../../../packages/shared/src/preferences/appearance/http';
import type { AppearanceView } from '../../../packages/shared/src/preferences/appearance/model';
import { E2E_URLS } from './test-env';

export async function getTestAppearance(request: APIRequestContext): Promise<AppearanceView> {
	const response = await request.get('/api/v1/appearance');
	expect(response.status()).toBe(200);
	return readAppearanceView(await response.json());
}

/** Each test operation uses the observed version once; conflicts are never automatically retried. */
export async function updateTestAppearance(
	request: APIRequestContext,
	change: (input: AppearanceUpdateRequest) => void,
): Promise<AppearanceView> {
	const current = await getTestAppearance(request);
	const input: AppearanceUpdateRequest = { expectedVersion: current.version };
	change(input);
	const response = await request.put('/api/v1/appearance', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: readAppearanceUpdate(input),
	});
	expect(response.status()).toBe(200);
	const saved = readAppearanceView(await response.json());
	expect(saved.version).toBe(current.version + 1);
	return saved;
}
