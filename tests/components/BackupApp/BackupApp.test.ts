import { afterEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { authMessages } from '../../../src/auth/browser/auth-api.js';
import { appMessages } from '../../../src/app/browser/app-messages.js';
import BackupApp from '../../../src/backup/browser/BackupApp.vue';
import type { BackupApi } from '../../../src/backup/browser/backup-api.js';
import type { StateClient } from '../../../src/state/browser/state-api.js';
import type { BackupStatusSchema } from '../../../src/backup/backup-http-types.js';
import type { z } from 'zod';

type Job = z.infer<typeof BackupStatusSchema>;
const job: Job = { id: '00000000-0000-4000-8000-000000000001', state: 'restoring' };

function render(initial: Job | null = null) {
	let update!: (job: Job) => void;
	const status = vi.fn(async () => ({ job: initial }));
	const report = vi.fn();
	const api = { status } as unknown as BackupApi;
	const state = {
		subscribe(_topic: unknown, _schema: unknown, observer: { updated: (value: { job: Job }) => void }) {
			update = (value) => observer.updated({ job: value });
			return () => {};
		},
	} as unknown as Pick<StateClient, 'subscribe'>;
	const wrapper = mount(BackupApp, {
		props: { api, state, log: { report } },
		global: {
			plugins: [
				createI18n({
					legacy: false,
					locale: 'en',
					messages: {
						en: { ...appMessages.en, ...authMessages.en },
						zh: { ...appMessages.zh, ...authMessages.zh },
					},
				}),
			],
		},
	});
	return { wrapper, update, report };
}

afterEach(() => {
	document.body.innerHTML = '';
});

it.each(['succeeded', 'failed'] as const)('shows only active restore status and reports %s once', async (result) => {
	const { wrapper, update, report } = render();
	try {
		await flushPromises();
		update(job);
		await flushPromises();
		expect(wrapper.get('[role="status"]').text()).toBe('Restoring…');
		const finished = { ...job, state: result };
		update(finished);
		update(finished);
		update(job);
		await flushPromises();
		expect(wrapper.find('[role="status"]').exists()).toBe(false);
		expect(report).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				code: result === 'succeeded' ? 'BACKUP_RESTORED' : 'BACKUP_RESTORE_FAILED',
				userVisible: true,
			}),
		);
	} finally {
		wrapper.unmount();
	}
});

it('does not replay a historical restore notification on reopening the page', async () => {
	const { wrapper, report } = render({ ...job, state: 'succeeded' });
	try {
		await flushPromises();
		expect(wrapper.find('[role="status"]').exists()).toBe(false);
		expect(report).not.toHaveBeenCalled();
	} finally {
		wrapper.unmount();
	}
});
