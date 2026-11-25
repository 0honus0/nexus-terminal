import { expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import UiDropdownMenu from '../../../src/ui/browser/components/UiDropdownMenu.vue';

it.each(['disabled', 'empty'] as const)(
	'closes an open menu when it becomes %s and does not reopen on recovery',
	async (reason) => {
		const items = [{ id: 'one', label: 'One' }];
		const wrapper = mount(UiDropdownMenu, {
			props: { items },
			slots: { default: '<button type="button">Menu</button>' },
			attachTo: document.body,
		});
		try {
			const trigger = wrapper.get('button');
			await trigger.trigger('keydown', { key: 'Enter' });
			await flushPromises();
			expect(trigger.attributes('aria-expanded')).toBe('true');
			await wrapper.setProps(reason === 'disabled' ? { disabled: true } : { items: [] });
			await flushPromises();
			expect(trigger.attributes('aria-expanded')).toBe('false');
			expect(document.querySelector('[role="menu"]')).toBeNull();
			await wrapper.setProps({ items, disabled: false });
			await flushPromises();
			expect(trigger.attributes('aria-expanded')).toBe('false');
			await trigger.trigger('keydown', { key: 'Enter' });
			await flushPromises();
			expect(trigger.attributes('aria-expanded')).toBe('true');
		} finally {
			wrapper.unmount();
		}
	},
);
