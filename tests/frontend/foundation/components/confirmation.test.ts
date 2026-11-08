import { afterEach, expect, test } from 'vitest';
import { mount, enableAutoUnmount } from '@vue/test-utils';
import { h, nextTick, ref } from 'vue';
import UiConfirmationPanel from '../../../../packages/frontend/src/foundation/ui/UiConfirmationPanel.vue';
import UiButton from '../../../../packages/frontend/src/foundation/ui/UiButton.vue';

enableAutoUnmount(afterEach);

test('confirmation exposes its title and only closes on an enabled dismissal action', async () => {
	const wrapper = mount(UiConfirmationPanel, {
		attachTo: document.body,
		props: { visible: true, teleport: false, title: 'Reset terminal', closeOnEscape: true },
		slots: { default: '<input aria-label="Reason" />' },
	});
	const dialog = wrapper.get('[role="dialog"]');
	expect(document.getElementById(dialog.attributes('aria-labelledby') ?? '')?.textContent).toBe('Reset terminal');
	await dialog.get('input').trigger('click');
	expect(wrapper.emitted('close')).toBeUndefined();
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	expect(wrapper.emitted('close')).toHaveLength(1);
	await wrapper.setProps({ closeOnEscape: false });
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	expect(wrapper.emitted('close')).toHaveLength(1);
});

test('a pending confirmation cannot dispatch twice and becomes actionable after completion', async () => {
	let accepted = 0;
	const pending = ref(true);
	const wrapper = mount(UiConfirmationPanel, {
		attachTo: document.body,
		props: { visible: true, teleport: false, title: 'Delete connection' },
		slots: {
			actions: () =>
				h(
					UiButton,
					{
						loading: pending.value,

						onClick: () => accepted++,
					},
					() => 'Delete',
				),
		},
	});
	const button = wrapper.getComponent(UiButton);
	await button.get('button').trigger('click');
	expect(accepted).toBe(0);
	expect(button.attributes('aria-busy')).toBe('true');
	pending.value = false;
	await nextTick();
	await button.get('button').trigger('click');
	expect(accepted).toBe(1);
});
