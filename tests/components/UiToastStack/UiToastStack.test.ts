import { afterEach, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import UiDialog from '../../../src/ui/browser/components/UiDialog.vue';
import UiToastStack from '../../../src/ui/browser/components/UiToastStack.vue';
import type { UiToastItem } from '../../../src/ui/browser/ui-component-types.js';

const wrappers: VueWrapper[] = [];

afterEach(() => {
	wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
	vi.useRealTimers();
});

async function render(
	items: UiToastItem[] = [
		{ id: 1, tone: 'success', message: 'Saved' },
		{ id: 2, tone: 'error', message: 'Failed' },
	],
) {
	const wrapper = mount(UiToastStack, {
		attachTo: document.body,
		props: {
			items,
			label: 'Notifications',
			closeLabel: 'Close',
			expandLabel: 'Expand',
			collapseLabel: 'Collapse',

			positionLabel: (current, total) => `${current} of ${total}`,

			duration: Infinity,
		},
	});
	wrappers.push(wrapper);
	await flushPromises();
	return wrapper;
}

const card = () => document.querySelector<HTMLElement>('[data-ui=toast]')!;

it('shows one message with stacked metadata, preserves older entries and switches by keyboard', async () => {
	await render();
	expect(document.querySelectorAll('[data-ui=toast]')).toHaveLength(1);
	expect(card().textContent).toContain('Failed');
	card().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
	await flushPromises();
	expect(card().textContent).toContain('Saved');
	expect(document.querySelector('[data-ui=toast-stack]')!.getAttribute('data-count')).toBe('2');
});

it('dismisses only the selected message and selects a remaining neighbour', async () => {
	const wrapper = await render();
	card().querySelector<HTMLButtonElement>('[aria-label=Close]')!.click();
	await flushPromises();
	expect(wrapper.emitted('dismiss')).toEqual([[2]]);
	await wrapper.setProps({ items: [{ id: 1, tone: 'success', message: 'Saved' }] });
	expect(card().textContent).toContain('Saved');
	await wrapper.setProps({ items: [] });
	expect(document.querySelector('[data-ui=toast]')).toBeNull();
});

it('keeps translation reactive and expands long text without discarding other messages', async () => {
	vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100);
	const wrapper = await render();
	card().querySelector<HTMLButtonElement>('.ui-toast__expand')!.click();
	await flushPromises();
	expect(card().querySelector('.ui-toast__message')!.classList.contains('is-expanded')).toBe(true);
	await wrapper.setProps({
		items: [
			{ id: 1, tone: 'success', message: '已保存' },
			{ id: 2, tone: 'error', message: '失败' },
		],
	});
	expect(card().textContent).toContain('失败');
	expect(wrapper.emitted('dismiss')).toBeUndefined();
});

it.each([false, true])(
	'closes notifications before a focused dialog (dialog mounted first: %s)',
	async (dialogFirst) => {
		const items: UiToastItem[] = [
			{ id: 1, tone: 'success', message: 'Saved' },
			{ id: 2, tone: 'error', message: 'Failed' },
		];

		function renderDialog() {
			const wrapper = mount(UiDialog, {
				attachTo: document.body,
				props: { open: true, title: 'Details', closeLabel: 'Close' },
				slots: { default: '<input aria-label="Name" />' },
			});
			wrappers.push(wrapper);
			return wrapper;
		}

		const earlierDialog = dialogFirst ? renderDialog() : undefined;
		const toast = await render(items);
		const dialog = earlierDialog ?? renderDialog();
		await flushPromises();
		const input = document.querySelector<HTMLInputElement>('[data-ui=dialog] input')!;
		input.focus();

		function pressEscape() {
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		}

		pressEscape();
		expect(toast.emitted('dismiss')).toEqual([[2]]);
		expect(dialog.emitted('update:open')).toBeUndefined();
		await toast.setProps({ items: items.slice(0, 1) });
		pressEscape();
		expect(toast.emitted('dismiss')).toEqual([[2], [1]]);
		expect(dialog.emitted('update:open')).toBeUndefined();
		expect(document.activeElement).toBe(input);
		await toast.setProps({ items: [] });
		pressEscape();
		expect(dialog.emitted('update:open')).toEqual([[false]]);
	},
);

it('normalizes wheel navigation and does not bubble into desktop navigation', async () => {
	await render();
	const listener = vi.fn();
	document.addEventListener('wheel', listener);
	try {
		card().dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, bubbles: true, cancelable: true }));
		await flushPromises();
		expect(card().textContent).toContain('Saved');
		expect(listener).not.toHaveBeenCalled();
	} finally {
		document.removeEventListener('wheel', listener);
	}
});

it('preserves native scrolling of expanded messages instead of changing the selected notification', async () => {
	vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100);
	await render();
	card().querySelector<HTMLButtonElement>('.ui-toast__expand')!.click();
	await flushPromises();
	const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
	card().querySelector('.ui-toast__message')!.dispatchEvent(event);
	await flushPromises();
	expect(event.defaultPrevented).toBe(false);
	expect(card().textContent).toContain('Failed');
});

it('does not show an expand action for a message that fits', async () => {
	await render();
	expect(card().querySelector('[aria-expanded]')).toBeNull();
	expect(card().querySelector('.ui-toast__footer')).toBeNull();
	expect(card().querySelector('.ui-toast__controls .ui-toast__page')?.textContent).toContain('1 of 2');
});

it('pauses expiry when expanding a notification through a touch-style click', async () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100);
	const wrapper = await render();
	await wrapper.setProps({ duration: 1000 });
	card().querySelector<HTMLButtonElement>('.ui-toast__expand')!.click();
	await flushPromises();
	await vi.advanceTimersByTimeAsync(1500);
	expect(wrapper.emitted('dismiss')).toBeUndefined();
	expect(card().contains(document.activeElement)).toBe(true);
});
