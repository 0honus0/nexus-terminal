import { h, nextTick } from 'vue';
import { mount as mountComponent } from '@vue/test-utils';
import { expect, vi, onTestFinished } from 'vitest';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import { useNotificationStore } from '../../../../packages/frontend/src/shared/feedback/store/notification.store.ts';
import { useDialogStore } from '../../../../packages/frontend/src/shared/feedback/store/dialog.store.ts';
import { TargetRequestFailure } from '../../../../packages/frontend/src/client/targets/target-types.ts';

/** Actual target components and authenticated HTTP; no browser, layout or native file claims. */
export async function openTargetPanel(options = {}) {
	const { pinia, application, auth } = await openAuthenticatedFrontendApplication(options);
	await setLocale('en-US');
	const notifications = useNotificationStore(pinia);
	const dialogs = useDialogStore(pinia);
	const checks = [];
	const mounted = new Set();
	onTestFinished(() => {
		const failures = [];
		for (const panel of mounted) {
			try {
				panel.close();
			} catch (cause) {
				failures.push(cause);
			}
		}
		if (failures.length) throw new AggregateError(failures, 'Target panel cleanup failed');
	});
	return {
		pinia,
		auth,
		application,
		i18n,
		dialogs,
		checks,
		original: application.fetch,

		hasFeedback: (key) => notifications.notifications.some((item) => item.message === i18n.global.t(key)),

		check(value, name) {
			expect(value, name).toBeTruthy();
			checks.push(name);
		},

		async until(predicate) {
			await nextTick();
			await vi.waitFor(async () => expect(await predicate()).toBeTruthy(), { timeout: 5000, interval: 25 });
		},

		async failure(work, code) {
			try {
				await work();
			} catch (cause) {
				expect(cause).toBeInstanceOf(TargetRequestFailure);
				expect(cause.code).toBe(code);
				return cause;
			}
			throw new Error('Expected target failure: ' + code);
		},

		fill(id, value) {
			const node = document.getElementById(id);
			expect(node, 'Missing input: ' + id).not.toBeNull();
			expect(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement).toBe(true);
			node.value = value;
			node.dispatchEvent(new Event('input', { bubbles: true }));
		},

		response(body, status = 200) {
			return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
		},

		mount(component, props = {}, wrapper) {
			const node = document.createElement('div');
			document.body.append(node);
			const view = mountComponent(
				{ render: () => (wrapper ? wrapper(component, props) : h(component, props)) },
				{
					attachTo: node,
					global: { plugins: [pinia, i18n] },
				},
			);
			const panel = {
				node,

				close() {
					mounted.delete(panel);
					try {
						view.unmount();
					} finally {
						node.remove();
					}
				},
			};
			mounted.add(panel);
			return panel;
		},
	};
}
