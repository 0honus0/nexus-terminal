import { expect, test, vi, onTestFinished } from 'vitest';
import { createPinia } from 'pinia';
import { createApp, h, nextTick } from 'vue';
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import Overlay from '../../../../packages/frontend/src/features/backup/components/BackupRecoveryOverlay.vue';
import { useBackupStore } from '../../../../packages/frontend/src/features/backup/store/backup.store.ts';
import { backupApi } from '../../../../packages/frontend/src/features/backup/api/backup-api.ts';
import { BackupRequestFailure } from '../../../../packages/frontend/src/features/backup/model/backup-types.ts';

test('unknown restoration has no reload or dismiss action and keeps its fence across auth reset', async () => {
	await setLocale('en-US');
	const pinia = createPinia();
	const store = useBackupStore(pinia);
	vi.spyOn(backupApi, 'importFull').mockRejectedValue(new BackupRequestFailure('request_failed', 'unknown'));
	onTestFinished(() => vi.restoreAllMocks());
	const node = document.createElement('div');
	document.body.append(node);
	const mounted = createApp({ render: () => h(Overlay) });
	onTestFinished(() => {
		mounted.unmount();
		node.remove();
	});
	mounted.use(pinia).use(i18n).mount(node);
	await expect(
		store.importFull(new File(['x'], 'fixture.nexus-backup'), null, new AbortController().signal),
	).rejects.toBeInstanceOf(BackupRequestFailure);
	store.reset();
	await nextTick();
	const dialog = document.querySelector('[role=dialog]');
	expect(dialog).not.toBeNull();
	expect(dialog.textContent).toContain('The restoration result is unknown. Do not submit the import again.');
	expect(dialog.querySelectorAll('button')).toHaveLength(0);
	dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	await nextTick();
	expect(document.querySelector('[data-backup-recovery]')).not.toBeNull();
	expect(store.blocked).toBe(true);
});
