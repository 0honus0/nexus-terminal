import { test, expect, vi, onTestFinished } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { openMutations } from '../support/fixture.mjs';
import Panel from '../../../../packages/frontend/src/features/mutation-recovery/components/MutationRecoveryPanel.vue';
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import { authenticatedSessionLifecycle } from '../../../../packages/frontend/src/shared/session/public.ts';
import { useNotificationStore } from '../../../../packages/frontend/src/shared/feedback/store/notification.store.ts';

test('recovery form has no implicit confirmations or outcome and renders actual three-locale feedback', async () => {
	const { app, store, pinia, identity } = await openMutations();
	await setLocale('en-US');
	expect(authenticatedSessionLifecycle.attach(identity.user.id).failures).toHaveLength(0);
	onTestFinished(() => authenticatedSessionLifecycle.dispose());
	let writes = 0;
	vi.stubGlobal('fetch', (path, input) => {
		if (input?.method === 'POST') writes++;
		return app.fetch(path, input);
	});
	const node = document.createElement('div');
	document.body.append(node);
	const mounted = createApp({ render: () => h(Panel) });
	onTestFinished(() => {
		mounted.unmount();
		node.remove();
	});
	mounted.use(pinia).use(i18n).mount(node);
	await vi.waitFor(() => expect(store.items).toHaveLength(20), { timeout: 15000 });
	const item = Array.from(node.querySelectorAll('button')).find((button) =>
		button.textContent.trim().startsWith('fixture-04'),
	);
	item.click();
	await vi.waitFor(() => expect(store.selected?.id).toBe('fixture-04'), { timeout: 15000 });
	expect(node.querySelectorAll('input[type=checkbox]:checked')).toHaveLength(0);
	expect(node.querySelector('#mutation-outcome').getAttribute('data-value')).toBe('');
	Array.from(node.querySelectorAll('button'))
		.find((button) => button.textContent.trim() === 'Record evidence')
		.click();
	const feedback = useNotificationStore(pinia);
	await vi.waitFor(() =>
		expect(feedback.notifications.some((item) => item.message.includes('Confirm both resources'))).toBe(true),
	);
	expect(writes).toBe(0);
	for (const [locale, heading] of [
		['zh-CN', '机器突变恢复'],
		['ja-JP', 'マシン変更の復旧'],
		['en-US', 'Machine mutation recovery'],
	]) {
		await setLocale(locale);
		await nextTick();
		expect(node.textContent).toContain(heading);
		expect(node.textContent).not.toContain('mutationRecovery.');
	}
});
