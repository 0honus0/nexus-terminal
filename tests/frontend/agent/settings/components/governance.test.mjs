import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, isProxy } from 'vue';
import { expect, test, vi } from 'vitest';
import i18n, { setLocale } from '../../../../../packages/frontend/src/app/i18n/index.ts';
import { authenticatedSessionLifecycle } from '../../../../../packages/frontend/src/shared/session/authenticatedSessionLifecycle.ts';
import { useAppGovernance } from '../../../../../packages/frontend/src/features/agent/composables/use-app-governance.ts';

const api = vi.hoisted(() => ({ getAppGrants: vi.fn(), saveAppGrants: vi.fn() }));
vi.mock('../../../../../packages/frontend/src/features/agent/api/app-management-api.ts', () => api);

test('removing reactive grant rows snapshots retained nested scopes before saving', async () => {
	await setLocale('en-US');
	const appId = 'f242712e-ef7c-4e2a-b97f-75cfb6b18423';
	const grants = [
		{ capability: 'file.read', scope: { kind: 'targets', ssh: { mode: 'ids', ids: ['1', '2'] } } },
		{ capability: 'file.write', scope: { kind: 'targets', ssh: { mode: 'all' } } },
		{ capability: 'context.read', scope: { kind: 'global' } },
	];
	api.getAppGrants.mockResolvedValue({ appId, revision: 3, definitions: [], grants });
	api.saveAppGrants.mockImplementation(async (_appId, revision, input) => {
		expect(input.every((item) => !isProxy(item) && !isProxy(item.scope))).toBe(true);
		expect(structuredClone(input)).toEqual([grants[0], grants[2]]);
		return { appId, revision: revision + 1, definitions: [], grants: input };
	});
	authenticatedSessionLifecycle.attach(1);
	let editor;
	const wrapper = mount(
		defineComponent({
			setup() {
				editor = useAppGovernance(appId, 'grants');
				return () => h('div');
			},
		}),
		{ global: { plugins: [i18n, createPinia()] } },
	);
	try {
		await flushPromises();
		editor.grantDraft.value = editor.grantDraft.value.filter((grant) => grant.capability !== 'file.write');
		await editor.saveGrants();
		expect(api.saveAppGrants).toHaveBeenCalledOnce();
		expect(editor.grants.value.revision).toBe(4);
		expect(editor.grantOperation.notice.value).toBe('saved');
	} finally {
		wrapper.unmount();
		authenticatedSessionLifecycle.dispose();
	}
});
