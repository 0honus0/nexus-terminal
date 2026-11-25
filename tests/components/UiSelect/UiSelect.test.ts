import { afterAll, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { h } from 'vue';
import UiSelect from '../../../src/ui/browser/components/UiSelect.vue';

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}

		unobserve() {}

		disconnect() {}
	},
);
afterAll(() => vi.unstubAllGlobals());

it('switches between adjacent selectors without locking the page or keeping both menus open', async () => {
	const options = [
		{ value: 'all', label: 'All' },
		{ value: 'one', label: 'One' },
	];
	const wrapper = mount(
		{
			render: () =>
				h('div', [h(UiSelect, { options, modelValue: 'all' }), h(UiSelect, { options, modelValue: 'all' })]),
		},
		{ attachTo: document.body },
	);
	const observedLabels: string[][] = [];
	const observer = new MutationObserver(() =>
		observedLabels.push(wrapper.findAll('.ui-select__value').map((value) => value.text())),
	);
	observer.observe(wrapper.element, { childList: true, characterData: true, subtree: true });
	try {
		const triggers = wrapper.findAll('[data-ui="select"]');
		for (const trigger of triggers)
			Object.defineProperty(trigger.element, 'hasPointerCapture', { value: () => false });
		await triggers[0].trigger('keydown', { key: 'ArrowDown' });
		await flushPromises();
		expect(triggers[0].attributes('aria-expanded')).toBe('true');
		expect(document.body.style.pointerEvents).not.toBe('none');
		expect(document.body.style.overflow).not.toBe('hidden');
		await new Promise((resolve) => setTimeout(resolve, 10));
		triggers[1].element.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
		);
		await flushPromises();
		expect(triggers[0].attributes('aria-expanded')).toBe('false');
		expect(triggers[1].attributes('aria-expanded')).toBe('true');
		expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
		expect(observedLabels.length).toBeGreaterThan(0);
		expect(observedLabels.every((labels) => labels.length === 2 && labels.every((label) => label === 'All'))).toBe(
			true,
		);
	} finally {
		observer.disconnect();
		wrapper.unmount();
	}
});

it.each(['disabled', 'empty'] as const)(
	'closes an open selector when it becomes %s and does not reopen on recovery',
	async (reason) => {
		const options = [
			{ value: 'all', label: 'All' },
			{ value: 'one', label: 'One' },
		];
		const wrapper = mount(UiSelect, { props: { options, modelValue: 'all' }, attachTo: document.body });
		try {
			const trigger = wrapper.get('[data-ui="select"]');
			await trigger.trigger('keydown', { key: 'ArrowDown' });
			await flushPromises();
			expect(trigger.attributes('aria-expanded')).toBe('true');
			await wrapper.setProps(reason === 'disabled' ? { disabled: true } : { options: [] });
			await flushPromises();
			expect(trigger.attributes('aria-expanded')).toBe('false');
			expect(document.querySelector('[role="listbox"]')).toBeNull();
			await wrapper.setProps({ options, disabled: false });
			await flushPromises();
			expect(trigger.attributes('aria-expanded')).toBe('false');
			expect(trigger.text()).toBe('All');
			await trigger.trigger('keydown', { key: 'ArrowDown' });
			await flushPromises();
			expect(trigger.attributes('aria-expanded')).toBe('true');
		} finally {
			wrapper.unmount();
		}
	},
);
