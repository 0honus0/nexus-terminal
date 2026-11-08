import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../../../../packages/frontend/src/features/auth/store/auth.store.ts';
import { openFrontendApplication } from '../../../support/http/frontend-application.mjs';
import baseline from '../../../fixtures/data/preferences/monitoring-settings.json' with { type: 'json' };
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import { createAccessApi } from '../../../../packages/frontend/src/features/auth/api/access-api.ts';
import Panel from '../../../../packages/frontend/src/features/preferences/components/MonitoringConfigurationPanel.vue';
import PreferencesPanel from '../../../../packages/frontend/src/features/preferences/components/PreferencesSettingsPanel.vue';
import WorkspacePanel from '../../../../packages/frontend/src/features/preferences/components/WorkspacePreferencesPanel.vue';
import { authenticatedSessionLifecycle } from '../../../../packages/frontend/src/shared/session/public.ts';
import { useNotificationStore } from '../../../../packages/frontend/src/shared/feedback/store/notification.store.ts';
afterEach(() => vi.unstubAllGlobals());
test('all monitoring settings surfaces perform one CAS write and render actual three-locale controls and Toast', async () => {
	const fixture = await openFrontendApplication();
	vi.stubGlobal('fetch', fixture.fetch);
	let mounted, node;
	const checks = [];

	const check = (value, name) => {
		assert.ok(value, name);
		checks.push(name);
	};

	const until = async (predicate) => {
		const deadline = performance.now() + 2000;
		while (!predicate()) {
			if (performance.now() > deadline)
				throw Error('monitoring UI did not converge: ' + node?.textContent?.slice(0, 500));
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	};

	let writes = 0;
	try {
		await setLocale('en-US');
		const access = createAccessApi();
		const password = 'fixture-password-123';
		await access.setup({ username: 'admin', password, confirmPassword: password });
		setActivePinia(createPinia());
		const login = await useAuthStore().login({ username: 'admin', password });
		assert.equal(login.status, 'authenticated');
		const attached = authenticatedSessionLifecycle.attach(login.user.id);
		assert.equal(attached.failures.length, 0);
		vi.stubGlobal('fetch', async (url, input) => {
			if (new URL(url, window.location.origin).pathname !== '/api/v1/settings') return fixture.fetch(url, input);
			if (input?.method !== 'PUT') return Response.json(baseline);
			writes++;
			const command = JSON.parse(input.body);
			assert.equal(command.captcha.secret.action, 'keep');
			assert.ok(!('effectiveMonitoring' in command));
			assert.deepEqual(command.policy.passkeys, baseline.policy.passkeys);
			return Response.json({
				...baseline,
				version: command.expectedVersion + 1,
				effectiveVersion: command.expectedVersion + 1,
				policy: command.policy,
				effectiveMonitoring: {
					statusMonitorIntervalSeconds: command.policy.statusMonitorIntervalSeconds,
					remoteHostRefreshIntervalSeconds: command.policy.remoteHostRefreshIntervalSeconds,
				},
			});
		});
		for (const component of [Panel, PreferencesPanel, WorkspacePanel]) {
			node = document.createElement('div');
			document.body.append(node);
			mounted = createApp({ render: () => h(component) });
			const pinia = createPinia();
			const notifications = useNotificationStore(pinia);
			mounted.use(pinia).use(i18n).mount(node);

			const savedFeedback = () =>
				notifications.notifications.some(
					(item) =>
						item.kind === 'success' && item.message === i18n.global.t('settings.monitoring.feedback.saved'),
				);

			await until(() => node.querySelector('input[data-monitoring-status]'));
			check(
				node.querySelectorAll('[data-monitoring-configuration]').length === 1,
				component.__name + ' exposes independent core configuration',
			);
			const control = node.querySelector('input[data-monitoring-status]');
			control.value = '13';
			control.dispatchEvent(new Event('input', { bubbles: true }));
			await nextTick();
			check(
				!node.querySelector('[data-monitoring-save]').disabled,
				component.__name + ' numeric input enables CAS save',
			);
			const count = writes;
			node.querySelector('[data-monitoring-configuration] form').dispatchEvent(
				new Event('submit', { bubbles: true, cancelable: true }),
			);
			await nextTick();
			await until(() => writes > count && savedFeedback());
			check(
				!node.querySelector('[data-monitoring-refresh]'),
				component.__name + ' hides recovery refresh after a confirmed save',
			);
			check(
				writes === count + 1 && savedFeedback(),
				component.__name + ' performs one write and publishes Toast feedback',
			);
			for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
				await setLocale(locale);
				await nextTick();
				check(
					!node.querySelector('[data-monitoring-configuration]').textContent.includes('settings.monitoring.'),
					component.__name + ' translates ' + locale,
				);
			}
			mounted.unmount();
			mounted = null;
			node.remove();
			node = null;
		}

		assert.equal(checks.length, 21);
	} finally {
		mounted?.unmount();
		node?.remove();
		authenticatedSessionLifecycle.dispose();
		await fixture.close();
	}
});
