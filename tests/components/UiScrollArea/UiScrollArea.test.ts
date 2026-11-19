import { expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import UiScrollArea from '../../../src/ui/browser/components/UiScrollArea.vue';

it('preserves the existing element, focus target and native scroll listener with asChild', () => {
	const onScroll = vi.fn();
	const wrapper = mount(UiScrollArea, {
		props: { asChild: true, gutter: 'stable' },
		attrs: { class: 'existing-list', onScroll },
		slots: { default: () => h('section', { tabindex: 0, 'aria-label': 'Entries' }, 'Content') },
		attachTo: document.body,
	});
	expect(wrapper.element.tagName).toBe('SECTION');
	expect(wrapper.element.children).toHaveLength(0);
	expect(wrapper.attributes('aria-label')).toBe('Entries');
	expect(wrapper.classes()).toContain('existing-list');
	(wrapper.element as HTMLElement).focus();
	expect(document.activeElement).toBe(wrapper.element);
	wrapper.element.dispatchEvent(new Event('scroll'));
	expect(onScroll).toHaveBeenCalledOnce();
	wrapper.unmount();
});
