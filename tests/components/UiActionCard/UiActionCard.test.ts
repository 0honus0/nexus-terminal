import { expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { h, ref, nextTick } from 'vue';
import { UiActionCard } from '../../../src/sdk/browser/ui-api.js';

it('forwards native interaction and provides a unique accessible description', async () => {
	const clicked = vi.fn();
	const disabled = ref(false);
	const wrapper = mount({
		render: () =>
			h('div', [
				h(UiActionCard, { label: 'App', disabled: disabled.value, onClick: clicked }, () => 'Details'),
				h(UiActionCard, { label: 'Other app' }),
			]),
	});
	const [first, second] = wrapper.findAll('button');
	await first.trigger('click');
	expect(clicked).toHaveBeenCalledTimes(1);
	expect(first.attributes('aria-label')).toBe('App');
	expect(first.attributes('aria-describedby')).not.toBe(second.attributes('aria-describedby'));
	disabled.value = true;
	await nextTick();
	await first.trigger('click');
	expect(clicked).toHaveBeenCalledTimes(1);
	wrapper.unmount();
});
