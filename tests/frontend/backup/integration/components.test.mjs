import { Blob } from 'node:buffer';
import { expect, test, vi, onTestFinished } from 'vitest';
import { createApp, h, ref, nextTick } from 'vue';
import { openBackup } from '../support/fixture.mjs';
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import Panel from '../../../../packages/frontend/src/features/backup/components/BackupSettingsPanel.vue';
import { authenticatedSessionLifecycle } from '../../../../packages/frontend/src/shared/session/public.ts';
import { useNotificationStore } from '../../../../packages/frontend/src/shared/feedback/store/notification.store.ts';

test('backup drafts are cleared on tab deactivation and actual wrong-password export reports safe feedback', async () => {
	const { pinia, identity } = await openBackup();
	vi.stubGlobal('Blob', Blob);
	await setLocale('en-US');
	expect(identity.status).toBe('authenticated');
	expect(authenticatedSessionLifecycle.attach(identity.user.id).failures).toHaveLength(0);
	onTestFinished(() => authenticatedSessionLifecycle.dispose());
	const active = ref(true);
	const node = document.createElement('div');
	document.body.append(node);
	const mounted = createApp({ render: () => h(Panel, { active: active.value }) });
	onTestFinished(() => {
		mounted.unmount();
		node.remove();
	});
	mounted.use(pinia).use(i18n).mount(node);

	const edit = (selector, value) => {
		const input = node.querySelector(selector);
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		return input;
	};

	edit('#backup-export-password', 'temporary export secret');
	edit('#backup-import-password', 'temporary import secret');
	const file = node.querySelector('#backup-import-file');
	const files = [new File(['fixture'], 'temporary.nexus-backup')];
	Object.defineProperty(file, 'files', {
		configurable: true,

		get: () => files,
	});
	file.dispatchEvent(new Event('change', { bubbles: true }));
	await nextTick();
	expect(node.textContent).toContain('temporary.nexus-backup');
	active.value = false;
	await nextTick();
	active.value = true;
	await nextTick();
	expect(node.querySelector('#backup-export-password').value).toBe('');
	expect(node.querySelector('#backup-import-password').value).toBe('');
	expect(file.value).toBe('');
	expect(node.textContent).not.toContain('temporary.nexus-backup');
	const password = edit('#backup-export-password', 'Wrong-fixture-password!');
	await nextTick();
	node.querySelector('[data-backup-export]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await nextTick();
	expect(password.value).toBe('');
	const feedback = useNotificationStore(pinia);
	await vi.waitFor(
		() => expect(feedback.notifications.some((item) => item.message === 'The password is incorrect.')).toBe(true),
		{ timeout: 15000 },
	);
	expect(node.textContent).not.toContain('Wrong-fixture-password!');
});
