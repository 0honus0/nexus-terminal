import { test, expect } from 'vitest';
import { openNotifications, webhookChange } from '../support/fixture.mjs';
import { OperationsRequestFailure } from '../../../../packages/frontend/src/client/operations/operations-request.ts';

test('real notification CRUD preserves original CAS, all three secret actions and safe views', async () => {
	const { api, store, origin } = await openNotifications();
	const change = webhookChange(origin);
	const initial = await store.save(change, null);
	expect(initial.version).toBe(1);
	expect(initial.config.kind).toBe('webhook');
	expect(initial.config.headers).toEqual([{ name: 'X-Fixture-Secret', hasValue: true }]);
	change.name = 'API webhook kept';
	change.config.headers[0].value = { action: 'keep' };
	const kept = await store.save(change, { id: initial.id, version: initial.version });
	expect(kept.version).toBe(2);
	expect(kept.config.headers[0].hasValue).toBe(true);
	await expect(store.save(change, { id: initial.id, version: initial.version })).rejects.toMatchObject({
		code: 'version_conflict',
		outcome: 'confirmed',
	});
	expect(store.needsRefresh).toBe(true);
	await expect(store.save(change, null)).rejects.toMatchObject({
		code: 'refresh_required',
		outcome: 'not_dispatched',
	});
	await store.load(true);

	const email = {
		name: 'API email',
		enabled: false,
		events: [],
		config: {
			kind: 'email',
			to: 'to@fixture.invalid',
			from: 'from@fixture.invalid',
			host: '127.0.0.1',
			port: 2525,
			secure: false,
			username: 'fixture',
			password: { action: 'replace', value: 'fixture-password' },
			bodyTemplate: null,
		},
	};
	const savedEmail = await api.create(email);
	expect(savedEmail.config.kind).toBe('email');
	expect(savedEmail.config.hasPassword).toBe(true);
	expect(savedEmail.config).not.toHaveProperty('password');
	email.config.password = { action: 'clear' };
	const cleared = await api.update(savedEmail.id, savedEmail.version, email);
	expect(cleared.config.hasPassword).toBe(false);
	await expect(api.remove(savedEmail.id, savedEmail.version)).rejects.toMatchObject({
		code: 'version_conflict',
		outcome: 'confirmed',
	});
	await api.remove(cleared.id, cleared.version);

	const telegram = await api.create({
		name: 'API Telegram',
		enabled: false,
		events: [],
		config: {
			kind: 'telegram',
			origin,
			chatId: 'fixture-chat',
			botToken: { action: 'replace', value: '123:fixture_token' },
			bodyTemplate: '{event}/{subjectId}/{time}',
		},
	});
	expect(telegram.config.kind).toBe('telegram');
	expect(telegram.config.hasBotToken).toBe(true);
	expect(telegram.config).not.toHaveProperty('botToken');
	await api.remove(telegram.id, telegram.version);
	await expect(api.remove('1', 1)).rejects.toBeInstanceOf(OperationsRequestFailure);
	await expect(api.remove('1', 1)).rejects.toMatchObject({ code: 'invalid_input', outcome: 'not_dispatched' });
	await expect(api.deliveries(0, 201)).rejects.toMatchObject({ code: 'invalid_input', outcome: 'not_dispatched' });
});

test('saved and unsaved test receipts correlate with actual HTTP delivery and server pagination', async () => {
	const { api, store, origin, calls } = await openNotifications();
	const saved = await store.save(webhookChange(origin), null);
	const savedTest = await api.testSaved(saved.id);
	const unsavedTest = await api.testUnsaved({
		kind: 'webhook',
		url: origin + '/unsaved',
		method: 'POST',
		headers: [],
		bodyTemplate: '{event}',
	});
	expect(savedTest).toMatchObject({ status: 'queued', settingId: saved.id });
	expect(unsavedTest).toMatchObject({ status: 'queued', settingId: null });
	let delivered;
	await expect
		.poll(
			async () => {
				delivered = (await api.deliveries(0, 200)).items.filter(
					(item) => item.id === savedTest.id || item.id === unsavedTest.id,
				);
				return delivered.length === 2 && delivered.every((item) => item.status === 'sent');
			},
			{ timeout: 10000, interval: 25 },
		)
		.toBe(true);
	const first = await api.deliveries(0, 1);
	expect(first.items).toHaveLength(1);
	expect(first.nextOffset).toBe(1);
	const second = await api.deliveries(first.nextOffset, 1);
	expect(second.items).toHaveLength(1);
	expect(second.items[0].id).not.toBe(first.items[0].id);
	expect(calls.filter((item) => item.path === '/saved')).toHaveLength(1);
	expect(calls.find((item) => item.path === '/saved').header).toBe('local-fixture-value');
	expect(calls.filter((item) => item.path === '/unsaved')).toHaveLength(1);
});
