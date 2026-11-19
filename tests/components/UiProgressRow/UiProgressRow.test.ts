import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import { UiProgressRow } from '../../../src/ui/browser/ui-components-api.js';

it('keeps one task row while status changes and completes at 100 percent', async () => {
	const wrapper = mount(UiProgressRow, { props: { label: 'Restore', state: 'running', statusLabel: 'Running' } });
	const element = wrapper.element;
	expect(wrapper.get('progress').attributes('value')).toBeUndefined();
	await wrapper.setProps({ value: 35 });
	expect(wrapper.text()).toContain('35%');
	await wrapper.setProps({ state: 'succeeded', statusLabel: 'Done' });
	expect(wrapper.element).toBe(element);
	expect(wrapper.get('progress').attributes('value')).toBe('100');
	expect(wrapper.get('.ui-progress-row__status').attributes('aria-label')).toBe('Done');
	wrapper.unmount();
});
