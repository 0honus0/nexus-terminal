import { expect, test, loginAsAdmin } from '../../../../support/http/protocol-fixture.mjs';
import { readAccessStatus } from '../../../../../packages/shared/src/access/http.ts';
import { readSettingsResponse } from '../../../../../packages/shared/src/preferences/configuration/http-codec.ts';
test('rejects unauthenticated access to auth status', async ({ request }) => {
	const response = await request.get('/api/v1/auth/status');
	expect(response.status()).toBe(401);
	await expect(response.json()).resolves.toEqual({ code: 'unauthenticated' });
});
test('logs in through HTTP and accesses protected APIs', async ({ request }) => {
	await loginAsAdmin(request);
	const authStatus = await request.get('/api/v1/auth/status');
	expect(authStatus.ok()).toBeTruthy();
	expect(readAccessStatus(await authStatus.json()).user.username).toBe('admin');
	const settings = await request.get('/api/v1/settings');
	expect(settings.ok()).toBeTruthy();
	readSettingsResponse(await settings.json());
});
