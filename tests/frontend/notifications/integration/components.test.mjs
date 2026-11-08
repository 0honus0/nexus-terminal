import { test, expect, onTestFinished, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { openNotifications, webhookChange } from '../support/fixture.mjs';
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import NotificationsView from '../../../../packages/frontend/src/features/notifications/views/NotificationsView.vue';
import { authenticatedSessionLifecycle } from '../../../../packages/frontend/src/shared/session/public.ts';
import { useNotificationStore } from '../../../../packages/frontend/src/shared/feedback/store/notification.store.ts';

test('notification forms use actual HTTP, hide saved secrets, report queued tests and clear the auth cache', async () => {
	const { store, origin, pinia, login } = await openNotifications();
	await setLocale('en-US');
	expect(login.status).toBe('authenticated');
	const attached = authenticatedSessionLifecycle.attach(login.user.id);
	expect(attached.failures).toHaveLength(0);
	onTestFinished(() => authenticatedSessionLifecycle.dispose());
	await store.save(webhookChange(origin, 'API webhook kept'), null);
	const node = document.createElement('div');
	document.body.append(node);
	const mounted = createApp({ render: () => h(NotificationsView) });
	onTestFinished(() => {
		mounted.unmount();
		node.remove();
	});
	mounted.use(pinia).use(i18n).mount(node);
	const feedback = useNotificationStore(pinia);

	const button = (label, root = document) =>
		Array.from(root.querySelectorAll('button')).find(
			(item) => item.textContent.trim() === label || item.getAttribute('aria-label') === label,
		);

	await vi.waitFor(
		() => {
			expect(store.loading).toBe(false);
			expect(store.needsRefresh).toBe(false);
			expect(button('Add Notification Channel', node)).toBeDefined();
		},
		{ timeout: 15000 },
	);
	button('Add Notification Channel', node).click();
	await nextTick();
	for (const [selector, value] of [
		['#setting-name', 'Formal UI webhook'],
		['#webhook-url', origin + '/formal'],
	]) {
		const input = document.querySelector(selector);
		expect(input).not.toBeNull();
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}
	await nextTick();
	document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await vi.waitFor(
		() => {
			expect(node.textContent).toContain('Formal UI webhook');
			expect(document.querySelector('#setting-name')).toBeNull();
		},
		{ timeout: 15000 },
	);
	const card = Array.from(node.querySelectorAll('[data-notification-id]')).find((item) =>
		item.textContent.includes('API webhook kept'),
	);
	button('Edit', card).click();
	await nextTick();
	expect(document.querySelector('form').textContent).toContain('Saved value exists');
	expect(document.querySelectorAll('form input[type=password]')).toHaveLength(0);
	button('Test saved configuration', document.querySelector('form')).click();
	await vi.waitFor(
		() =>
			expect(feedback.notifications.some((item) => item.kind === 'info' && item.message.includes('Queued'))).toBe(
				true,
			),
		{ timeout: 15000 },
	);
	button('Cancel', document.querySelector('form')).click();
	await nextTick();
	for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
		await setLocale(locale);
		for (const key of [
			'settings.notifications.unknown',
			'settings.notifications.refresh',
			'settings.notifications.form.keepSecret',
			'settings.notifications.deliveryStatus.unknown',
		]) {
			expect(i18n.global.te(key, locale), locale + '/' + key).toBe(true);
		}
	}
	store.reset();
	await nextTick();
	expect(node.querySelectorAll('[data-notification-id]')).toHaveLength(0);
	expect(document.querySelectorAll('[data-runtime-boundary]')).toHaveLength(0);
});
