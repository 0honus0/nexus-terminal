import { createServer } from 'node:http';
import { createPinia, setActivePinia } from 'pinia';
import { onTestFinished, vi } from 'vitest';
import { openFrontendApplication } from '../../../support/http/frontend-application.mjs';
import { createAccessApi } from '../../../../packages/frontend/src/features/auth/api/access-api.ts';
import { useAuthStore } from '../../../../packages/frontend/src/features/auth/store/auth.store.ts';
import { notificationsApi } from '../../../../packages/frontend/src/features/notifications/api/notifications-api.ts';
import { useNotificationsStore } from '../../../../packages/frontend/src/features/notifications/store/notifications.store.ts';

export function webhookChange(origin, name = 'API webhook', path = '/saved') {
	return {
		name,
		enabled: false,
		events: ['LOGIN_SUCCESS'],
		config: {
			kind: 'webhook',
			url: origin + path,
			method: 'POST',
			headers: [{ name: 'X-Fixture-Secret', value: { action: 'replace', value: 'local-fixture-value' } }],
			bodyTemplate: null,
		},
	};
}

export async function openNotifications() {
	const app = await openFrontendApplication();
	const calls = [];
	const receiver = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		calls.push({
			path: request.url,
			header: request.headers['x-fixture-secret'],
			body: Buffer.concat(chunks).toString('utf8'),
		});
		response.writeHead(200, { 'Content-Type': 'application/json' });
		response.end('{"ok":true}');
	});
	// Register before listening so setup failures still own both independent resources.
	onTestFinished(
		() =>
			new Promise((resolve, reject) => {
				receiver.close((cause) => (cause ? reject(cause) : resolve()));
				receiver.closeAllConnections();
			}),
	);
	await new Promise((resolve, reject) => {
		receiver.once('error', reject);
		receiver.listen(0, '127.0.0.1', resolve);
	});
	const origin = 'http://127.0.0.1:' + receiver.address().port;
	vi.stubGlobal('fetch', app.fetch);
	onTestFinished(() => vi.unstubAllGlobals());
	const access = createAccessApi();
	const password = 'Notification-fixture-2026!';
	await access.setup({ username: 'admin', password, confirmPassword: password });
	const pinia = createPinia();
	setActivePinia(pinia);
	const login = await useAuthStore(pinia).login({ username: 'admin', password, rememberMe: false });
	const store = useNotificationsStore(pinia);
	onTestFinished(() => store.reset());
	await store.load(true);
	return { app, api: notificationsApi, store, pinia, login, origin, calls };
}
