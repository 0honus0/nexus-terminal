import { mount } from '@vue/test-utils';
import { it, expect } from 'vitest';
import UiTabs from '../../../src/ui/browser/components/UiTabs.vue';
it('selects panels, preserving inactive content only when stable height is requested', async () => {
	const wrapper = mount(UiTabs, {
		props: {
			options: [
				{ value: 'a', label: 'A' },
				{ value: 'b', label: 'B' },
			],
			defaultValue: 'a',
			label: 'Views',
			stableHeight: true,
		},
		slots: { a: 'First', b: 'Second' },
	});
	expect(wrapper.findAll('[role="tabpanel"]')).toHaveLength(2);
	await wrapper.findAll('[role="tab"]')[1]!.trigger('mousedown', { button: 0 });
	expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['b']);
	expect(wrapper.findAll('[role="tabpanel"]')[0]!.attributes('data-state')).toBe('inactive');
	wrapper.unmount();
});
