import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick, ref } from 'vue';
import { expect, test } from 'vitest';
import i18n, { setLocale } from '../../../../../packages/frontend/src/app/i18n/index.ts';
import { authenticatedSessionLifecycle } from '../../../../../packages/frontend/src/shared/session/authenticatedSessionLifecycle.ts';
import { useAgentManagementOperation } from '../../../../../packages/frontend/src/features/agent/composables/use-agent-management-operation.ts';
import { AgentManagementFailure } from '../../../../../packages/frontend/src/features/agent/model/management-failure.ts';
import { HttpRequestFailure } from '../../../../../packages/frontend/src/client/http/request-failure.ts';

for (const network of [false, true]) {
	test(`settings recovery distinguishes initial reads, failures and re-entry (${network ? 'network' : 'server'})`, async () => {
		await setLocale('en-US');
		authenticatedSessionLifecycle.attach(1);
		const active = ref(true);
		let operation;
		const wrapper = mount(
			defineComponent({
				setup() {
					operation = useAgentManagementOperation(undefined, () => active.value);
					return () => h('div');
				},
			}),
			{ global: { plugins: [i18n, createPinia()] } },
		);
		const firstRead = Promise.withResolvers();
		const staleRead = Promise.withResolvers();
		try {
			expect(operation.refreshRequired.value).toBe(true);
			expect(operation.recoveryRequired.value).toBe(false);
			const reading = operation.execute(
				() => firstRead.promise,
				() => {},
				{ write: false },
			);
			expect(operation.busy.value).toBe(true);
			expect(operation.recoveryRequired.value).toBe(false);
			firstRead.reject(
				network
					? new HttpRequestFailure('request_failed', 'confirmed')
					: new AgentManagementFailure('storage_unavailable', 'confirmed'),
			);
			await reading;
			expect(operation.recoveryRequired.value).toBe(true);
			if (network) {
				expect(operation.notice.value).toBe('');
			}
			const stale = operation.execute(
				() => staleRead.promise,
				() => {},
				{ write: false },
			);
			expect(operation.recoveryRequired.value).toBe(false);
			active.value = false;
			await nextTick();
			active.value = true;
			await nextTick();
			expect(operation.refreshRequired.value).toBe(true);
			expect(operation.recoveryRequired.value).toBe(false);
			staleRead.reject(new AgentManagementFailure('storage_unavailable', 'confirmed'));
			await stale;
			expect(operation.recoveryRequired.value).toBe(false);
			await operation.execute(
				async () => 'current',
				() => {},
				{ write: false },
			);
			expect(operation.refreshRequired.value).toBe(false);
			expect(operation.recoveryRequired.value).toBe(false);
			await operation.execute(
				async () => {},
				() => {},
				{ write: true, refreshAfterSuccess: true },
			);
			expect(operation.refreshRequired.value).toBe(true);
			expect(operation.recoveryRequired.value).toBe(false);
			operation.reportFailure(undefined, true);
			expect(operation.recoveryRequired.value).toBe(true);
		} finally {
			firstRead.resolve();
			staleRead.resolve();
			wrapper.unmount();
			authenticatedSessionLifecycle.dispose();
		}
	});
}
