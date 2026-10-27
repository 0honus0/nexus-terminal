import { randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH } from '../../support/ssh';
import {
	createTestNotification,
	listTestNotifications,
	removeTestNotification,
	deliverTestNotification,
	notificationHeaders,
	NOTIFICATIONS_PATH,
} from '../../support/notifications';
import { readNotificationResponse, readOperationsError } from '../../../../packages/shared/src/operations/http-codec';
import type { NotificationConfigInput } from '../../../../packages/shared/src/operations/notifications/http';

const cases = [
	{ name: 'every webhook header value is redacted regardless of its name or casing', kind: 'redact' },
	{ name: 'explicit keep preserves credentials using different header casing', kind: 'preserve' },
	{ name: 'null cannot stand in for an explicit public header command', kind: 'public-null' },
	{ name: 'null cannot create an unknown secret header', kind: 'unknown-null' },
	{ name: 'legacy secret classification is rejected instead of exposing retained values', kind: 'unmark' },
	{ name: 'invalid custom secret header name is rejected atomically', kind: 'invalid-name' },
	{ name: 'non-string replacement values are rejected atomically', kind: 'invalid-value' },
	{ name: 'case-colliding edits cannot expose retained credentials', kind: 'case-collision' },
	{ name: 'reversing case-colliding edits cannot bypass rejection', kind: 'reverse-collision' },
] as const;

function config(): Extract<NotificationConfigInput, { kind: 'webhook' }> {
	return {
		kind: 'webhook',
		url: `${E2E_SSH.controlUrl}/e2e-notification-webhook-secrets?phase=original`,
		method: 'POST',
		bodyTemplate: null,
		headers: [
			{ name: 'Authorization', value: { action: 'replace', value: 'Bearer e2e-original' } },
			{ name: 'X-E2E-Private', value: { action: 'replace', value: 'private-original' } },
			{ name: 'X-Public', value: { action: 'replace', value: 'visible' } },
			{ name: 'X-Api-Key', value: { action: 'replace', value: 'key-original' } },
			{ name: 'Cookie', value: { action: 'replace', value: 'cookie-original' } },
		],
	};
}

test('case-colliding headers are rejected on create and unsaved delivery without persistence', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const name = `E2E Header Collision ${randomUUID()}`;
	const input = config();
	input.headers.push({ name: 'authorization', value: { action: 'replace', value: 'Bearer e2e-replacement' } });
	for (const [path, data] of [
		[NOTIFICATIONS_PATH, { name, enabled: false, events: [], config: input }],
		[NOTIFICATIONS_PATH + '/test-unsaved', { config: input }],
	] as const) {
		const response = await request.post(path, { headers: notificationHeaders, data });
		expect(response.status()).toBe(400);
		expect(readOperationsError(await response.json()).code).toBe('invalid_input');
	}
	expect((await listTestNotifications(request)).some((value) => value.name === name)).toBe(false);
});

for (const scenario of cases) {
	test(scenario.name, async ({ request }) => {
		await loginAsInitialAdmin(request);
		const name = `E2E Secret Contract ${randomUUID()}`;
		const initial = await createTestNotification(request, { name, enabled: false, events: [], config: config() });
		try {
			expect(initial.config.kind).toBe('webhook');
			if (initial.config.kind !== 'webhook') throw new Error('Unexpected notification kind');
			expect(initial.config.headers).toEqual(
				config().headers.map((header) => ({ name: header.name, hasValue: true })),
			);
			const redacted = JSON.stringify(initial);
			for (const secret of [
				'Bearer e2e-original',
				'private-original',
				'key-original',
				'cookie-original',
				'visible',
			])
				expect(redacted).not.toContain(secret);
			if (scenario.kind !== 'redact') {
				const keep = { action: 'keep' };
				const replacement = { action: 'replace', value: 'public-replacement' };
				const changes: Record<string, object> = {
					preserve: {
						headers: [
							{ name: 'authorization', value: keep },
							{ name: 'x-e2e-private', value: keep },
							{ name: 'X-Public', value: keep },
						],
					},
					'public-null': { headers: [{ name: 'X-Public', value: null }] },
					'unknown-null': { headers: [{ name: 'X-New-Secret', value: null }] },
					unmark: { secretHeaderNames: [] },
					'invalid-name': { headers: [{ name: 'invalid header', value: keep }] },
					'invalid-value': { headers: [{ name: 'Authorization', value: { action: 'replace', value: 123 } }] },
					'case-collision': {
						headers: [
							{ name: 'X-E2E-Private', value: replacement },
							{ name: 'x-e2e-private', value: keep },
						],
					},
					'reverse-collision': {
						headers: [
							{ name: 'x-e2e-private', value: keep },
							{ name: 'X-E2E-Private', value: replacement },
						],
					},
				};
				const updated = await request.put(NOTIFICATIONS_PATH + '/' + initial.id, {
					headers: notificationHeaders,
					data: {
						expectedVersion: initial.version,
						name: `${name} edited`,
						enabled: false,
						events: [],
						config: { ...config(), ...changes[scenario.kind] },
					},
				});
				expect(updated.status()).toBe(scenario.kind === 'preserve' ? 200 : 400);
				const body: unknown = await updated.json();
				expect(JSON.stringify(body)).not.toContain('private-original');
				if (scenario.kind === 'preserve') {
					const saved = readNotificationResponse(body).setting;
					expect(saved.version).toBe(initial.version + 1);
				} else expect(readOperationsError(body).code).toBe('invalid_input');
			}
			const stored = (await listTestNotifications(request)).find((item) => item.id === initial.id);
			expect(stored).toBeDefined();
			if (!stored) throw new Error('Notification disappeared');
			expect(stored.name).toBe(scenario.kind === 'preserve' ? `${name} edited` : name);
			expect(stored.version).toBe(initial.version + (scenario.kind === 'preserve' ? 1 : 0));
			expect(JSON.stringify(stored)).not.toContain('Bearer e2e-original');
			if (scenario.kind !== 'preserve') expect(stored.config).toEqual(initial.config);
			await deliverTestNotification(request, initial.id);
		} finally {
			const current = (await listTestNotifications(request)).find((item) => item.id === initial.id);
			if (current) await removeTestNotification(request, current);
		}
	});
}
