import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import { UiProgress } from '../../../src/ui/browser/ui-components-api.js';

it('distinguishes zero progress from indeterminate work and exposes an accessible name', async () => {
	const wrapper = mount(UiProgress, { props: { label: 'Install' } });
	const progress = wrapper.get('progress');
	expect(progress.attributes('value')).toBeUndefined();
	expect(progress.attributes('aria-label')).toBe('Install');
	await wrapper.setProps({ value: 0 });
	expect(progress.attributes('value')).toBe('0');
	await wrapper.setProps({ value: 75 });
	expect((progress.element as HTMLProgressElement).position).toBe(0.75);
	wrapper.unmount();
});
