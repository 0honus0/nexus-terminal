import { expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import UiSection from '../../../src/ui/browser/components/UiSection.vue';

it('preserves form state while collapsing content and keeps heading actions independent', async () => {
	const manage = vi.fn();
	const wrapper = mount(UiSection, {
		props: { title: 'Repositories', collapsible: true },
		slots: {
			default: () => h('input', { 'aria-label': 'Repository URL' }),

			actions: () => h('button', { onClick: manage }, 'Manage'),
		},
		attachTo: document.body,
	});
	try {
		const trigger = wrapper.get('button[aria-expanded]');
		const input = wrapper.get('input');
		await flushPromises();
		expect(trigger.attributes('aria-expanded')).toBe('true');
		expect(trigger.attributes('aria-controls')).toBe(wrapper.get('.ui-section__content').attributes('id'));
		await input.setValue('https://example.test/catalog.json');
		await trigger.trigger('click');
		await flushPromises();
		expect(trigger.attributes('aria-expanded')).toBe('false');
		expect(input.isVisible()).toBe(false);
		expect(wrapper.get('input').element).toBe(input.element);
		await wrapper.get('button:not([aria-expanded])').trigger('click');
		expect(manage).toHaveBeenCalledOnce();
		expect(trigger.attributes('aria-expanded')).toBe('false');
		await trigger.trigger('click');
		await flushPromises();
		expect(input.isVisible()).toBe(true);
		expect(input.element.value).toBe('https://example.test/catalog.json');
		expect(wrapper.emitted('update:open')).toEqual([[false], [true]]);
	} finally {
		wrapper.unmount();
	}
});

it('supports controlled expansion and keeps ordinary sections as static layouts', async () => {
	const wrapper = mount(UiSection, {
		props: { title: 'Plugins', collapsible: true, open: false },
		slots: { default: '<p>Installed plugins</p>' },
		attachTo: document.body,
	});
	try {
		expect(wrapper.get('p').isVisible()).toBe(false);
		await wrapper.setProps({ open: true });
		expect(wrapper.get('p').isVisible()).toBe(true);
		await wrapper.setProps({ collapsible: false, open: false });
		expect(wrapper.get('p').isVisible()).toBe(true);
		expect(wrapper.find('button[aria-expanded]').exists()).toBe(false);
		expect(wrapper.get('p').element.parentElement).toBe(wrapper.element);
	} finally {
		wrapper.unmount();
	}
});
