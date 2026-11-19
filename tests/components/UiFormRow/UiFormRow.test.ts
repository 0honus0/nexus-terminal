import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { expect, it } from 'vitest';
import { UiFormRow, UiInput, UiSwitch } from '../../../src/ui/browser/ui-components-api.js';

it('associates generated labels and descriptions with independent native and Reka controls', () => {
	const wrapper = mount(
		defineComponent({
			components: { UiFormRow, UiInput, UiSwitch },
			template: `<div>
			<UiFormRow label="Name" description="Help" v-slot="field"><UiInput :id="field.id" :aria-describedby="field.describedby" /></UiFormRow>
			<UiFormRow label="Motion" v-slot="field"><UiSwitch :model-value="true" :id="field.id" /></UiFormRow>
		</div>`,
		}),
	);
	const input = wrapper.get('input');
	const control = wrapper.get('[role="switch"]');
	const labels = wrapper.findAll('label');
	expect(labels[0]!.attributes('for')).toBe(input.attributes('id'));
	expect(labels[1]!.attributes('for')).toBe(control.attributes('id'));
	expect(input.attributes('id')).not.toBe(control.attributes('id'));
	expect(input.attributes('aria-describedby')).toBe(wrapper.get('p').attributes('id'));
	wrapper.unmount();
});
