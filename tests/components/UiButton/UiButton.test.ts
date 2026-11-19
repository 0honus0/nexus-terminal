import { expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, onUnmounted } from 'vue';
import UiButton from '../../../src/ui/browser/components/UiButton.vue';

it.each([false, true])(
	'keeps content mounted and prevents duplicate clicks during loading (iconOnly=%s)',
	async (iconOnly) => {
		const unmounted = vi.fn();
		const clicked = vi.fn();
		const content = defineComponent({
			setup() {
				onUnmounted(unmounted);
				return () => h('span', 'Save');
			},
		});
		const wrapper = mount(UiButton, {
			props: { iconOnly, loadingAnimation: 'spinner', onClick: clicked },
			attrs: iconOnly ? { 'aria-label': 'Save' } : {},
			slots: {
				leading: '<svg />',

				default: () => h(content),

				trailing: '<span>↗</span>',
			},
		});
		try {
			const original = wrapper.get('.ui-button__content').element;
			await wrapper.trigger('click');
			await wrapper.setProps({ loading: true });
			expect(wrapper.get('.ui-button__content').element).toBe(original);
			expect(wrapper.text()).toBe('Save↗');
			expect(unmounted).not.toHaveBeenCalled();
			expect(wrapper.attributes('aria-busy')).toBe('true');
			expect(wrapper.get('.ui-button__loader').attributes('aria-hidden')).toBe('true');
			expect(wrapper.attributes('data-loading-placement')).toBe(iconOnly ? 'content' : 'leading');
			await wrapper.trigger('click');
			expect(clicked).toHaveBeenCalledTimes(1);
			await wrapper.setProps({ loading: false });
			expect(wrapper.find('.ui-button__loader').exists()).toBe(false);
			await wrapper.trigger('click');
			expect(clicked).toHaveBeenCalledTimes(2);
		} finally {
			wrapper.unmount();
		}
	},
);

it('replaces only the leading icon and keeps the label and trailing content mounted', async () => {
	const wrapper = mount(UiButton, {
		props: { loadingAnimation: 'spinner' },
		slots: { leading: '<svg />', default: '<span>Enable</span>', trailing: '<span>↗</span>' },
	});
	try {
		const icon = wrapper.get('svg').element;
		const label = wrapper.get('.ui-button__content > span:nth-child(2)').element;
		await wrapper.setProps({ loading: true });
		expect(wrapper.get('svg').element).toBe(icon);
		expect(wrapper.get('.ui-button__content > span:nth-child(2)').element).toBe(label);
		expect(wrapper.text()).toBe('Enable↗');
		expect(wrapper.find('.ui-button__leading .ui-button__spinner').exists()).toBe(true);
		expect(wrapper.find('.ui-button > .ui-button__loader').exists()).toBe(false);
		await wrapper.setProps({ loading: false });
		expect(wrapper.find('.ui-button__loader').exists()).toBe(false);
	} finally {
		wrapper.unmount();
	}
});

it.each([false, true])('animates the original icon without adding a spinner (iconOnly=%s)', async (iconOnly) => {
	const wrapper = mount(UiButton, {
		props: { iconOnly },
		attrs: iconOnly ? { 'aria-label': 'Refresh' } : {},
		slots: iconOnly ? { default: '<svg />' } : { leading: '<svg />', default: 'Refresh' },
	});
	try {
		const icon = wrapper.get('svg').element;
		await wrapper.setProps({ loading: true });
		expect(wrapper.attributes('data-loading-animation')).toBe('icon');
		expect(wrapper.get('svg').element).toBe(icon);
		expect(wrapper.find('.ui-button__spinner').exists()).toBe(false);
		await wrapper.setProps({ loadingAnimation: 'spinner' });
		expect(wrapper.attributes('data-loading-animation')).toBe('spinner');
		expect(wrapper.get('svg').element).toBe(icon);
		expect(wrapper.find('.ui-button__spinner').exists()).toBe(true);
	} finally {
		wrapper.unmount();
	}
});

it('uses a spinner for a text-only button', () => {
	const wrapper = mount(UiButton, { props: { loading: true }, slots: { default: 'Enable' } });
	expect(wrapper.attributes('data-loading-animation')).toBe('spinner');
	expect(wrapper.text()).toBe('Enable');
	wrapper.unmount();
});
