import { mount } from '@vue/test-utils';
import { it, expect } from 'vitest';
import UiSwitch from '../../../src/ui/browser/components/UiSwitch.vue';
it('changes by click and respects disabled state', async () => {
	const wrapper = mount(UiSwitch, {
		props: { modelValue: false },
		attrs: { 'aria-label': 'Motion' },
	});
	await wrapper.get('[role="switch"]').trigger('click');
	expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
	await wrapper.setProps({ disabled: true });
	expect(wrapper.get('[role="switch"]').attributes('disabled')).toBeDefined();
	wrapper.unmount();
});
