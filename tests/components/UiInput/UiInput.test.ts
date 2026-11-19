import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import { defineComponent } from 'vue';
import { UiInput, UiField } from '../../../src/ui/browser/ui-components-api.js';
describe('form primitives', () => {
	it('supports density and invalid state without losing native accessibility attributes', async () => {
		const wrapper = mount(UiInput, {
			props: { density: 'compact', invalid: true },
			attrs: { 'aria-describedby': 'help' },
		});
		expect(wrapper.attributes('data-density')).toBe('compact');
		expect(wrapper.get('input').attributes('aria-invalid')).toBe('true');
		expect(wrapper.get('input').attributes('aria-describedby')).toBe('help');
		await wrapper.setProps({ invalid: false });
		expect(wrapper.get('input').attributes('aria-invalid')).toBeUndefined();
		wrapper.unmount();
	});
	it('forwards form and accessibility attributes to the actual input', async () => {
		const wrapper = mount(UiInput, {
			props: { type: 'password' },
			attrs: {
				id: 'password',
				name: 'password',
				autocomplete: 'new-password',
				'aria-label': 'Password',
				required: true,
			},
		});
		const input = wrapper.get('input');
		expect(input.attributes('id')).toBe('password');
		expect(input.attributes('autocomplete')).toBe('new-password');
		await input.setValue('value');
		expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['value']);
		wrapper.unmount();
	});
	it('connects the label and help text without duplicate identifiers', () => {
		const component = defineComponent({
			components: { UiInput, UiField },
			template:
				'<div><UiField label="Name" hint="Help" v-slot="field"><UiInput :id="field.id" :aria-describedby="field.describedby" /></UiField><UiField label="Other" v-slot="field"><UiInput :id="field.id" /></UiField></div>',
		});
		const wrapper = mount(component);
		const inputs = wrapper.findAll('input');
		expect(inputs[0]!.attributes('id')).not.toBe(inputs[1]!.attributes('id'));
		expect(wrapper.get('label').attributes('for')).toBe(inputs[0]!.attributes('id'));
		expect(inputs[0]!.attributes('aria-describedby')).toBe(wrapper.get('p').attributes('id'));
		wrapper.unmount();
	});
});
