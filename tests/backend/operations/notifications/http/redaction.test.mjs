import { expect, test, loginAsAdmin, HTTP_TEST_ORIGIN } from '../../../../support/http/protocol-fixture.mjs';
import {
	readNotificationResponse,
	readNotificationList,
} from '../../../../../packages/shared/src/operations/http-codec.ts';
const headers = { Origin: HTTP_TEST_ORIGIN };
test('notification HTTP responses redact stored provider secrets', async ({ request }) => {
	await loginAsAdmin(request);
	// Telegram tokens must carry a numeric bot ID; keep a valid secret so
	// this exercises redaction rather than input validation.
	const secret = '123456:test-value-not-for-use';
	const inputs = [
		{
			name: 'E2E redacted email',
			enabled: false,
			events: ['LOGIN_SUCCESS'],
			config: {
				kind: 'email',
				to: 'recipient@example.test',
				from: 'nexus@example.test',
				host: '127.0.0.1',
				port: 2525,
				secure: false,
				username: 'e2e-user',
				password: { action: 'replace', value: secret },
				bodyTemplate: null,
			},
		},
		{
			name: 'E2E redacted telegram',
			enabled: false,
			events: ['LOGIN_SUCCESS'],
			config: {
				kind: 'telegram',
				origin: 'https://example.test',
				chatId: 'e2e-chat',
				botToken: { action: 'replace', value: secret },
				bodyTemplate: null,
			},
		},
	];
	const ids = [];
	for (const input of inputs) {
		const created = await request.post('/api/v1/settings/notifications', { headers, data: input });
		expect(created.status()).toBe(200);
		expect(await created.text()).not.toContain(secret);
		const view = readNotificationResponse(await created.json()).setting;
		ids.push(view.id);
		if (view.config.kind === 'email') expect(view.config.hasPassword).toBe(true);
		else if (view.config.kind === 'telegram') expect(view.config.hasBotToken).toBe(true);
	}
	const response = await request.get('/api/v1/settings/notifications');
	expect(response.ok()).toBeTruthy();
	expect(await response.text()).not.toContain(secret);
	const list = readNotificationList(await response.json());
	for (const id of ids) expect(list.items.some((item) => item.id === id)).toBe(true);
});
