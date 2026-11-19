import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import UiContextMenu from '../../../src/ui/browser/components/UiContextMenu.vue';

// JSDOM 没有布局观测器；定位与碰撞由真实浏览器验收，此处验证选项和事件。
vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}

		unobserve() {}

		disconnect() {}
	},
);
afterEach(() => {
	document.body.innerHTML = '';
});
afterAll(() => vi.unstubAllGlobals());

it('uses Reka menu semantics, skips disabled actions and emits the chosen stable ID', async () => {
	const wrapper = mount(UiContextMenu, {
		attachTo: document.body,
		props: {
			items: [
				{ id: 'pin', label: 'Pin' },
				{ separatorBefore: true, id: 'close', label: 'Close', disabled: true, tone: 'danger' },
			],
		},
		slots: { default: '<button>Application</button>' },
	});
	await wrapper.find('button').trigger('contextmenu', { clientX: 50, clientY: 40 });
	await flushPromises();
	const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
	expect(items).toHaveLength(2);
	expect(document.querySelector('[role=separator]')).not.toBeNull();
	expect(items[1].hasAttribute('data-disabled')).toBe(true);
	items[0].click();
	await flushPromises();
	expect(wrapper.emitted('select')).toEqual([['pin']]);
	wrapper.unmount();
});

it('does not open when the entry is disabled', async () => {
	const wrapper = mount(UiContextMenu, {
		attachTo: document.body,
		props: { disabled: true, items: [{ id: 'pin', label: 'Pin' }] },
		slots: { default: '<button>Application</button>' },
	});
	await wrapper.find('button').trigger('contextmenu');
	await flushPromises();
	expect(document.querySelector('[role="menu"]')).toBeNull();
	wrapper.unmount();
});

it('does not select a menu item when the opening right-click releases over it', async () => {
	const wrapper = mount(UiContextMenu, {
		attachTo: document.body,
		props: { items: [{ id: 'pin', label: 'Pin' }] },
		slots: { default: '<button>Application</button>' },
	});
	try {
		await wrapper.find('button').trigger('contextmenu', { clientX: 50, clientY: 40 });
		await flushPromises();
		const item = document.querySelector<HTMLElement>('[role=menuitem]')!;
		item.dispatchEvent(
			new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 2, pointerType: 'mouse' }),
		);
		await flushPromises();
		expect(wrapper.emitted('select')).toBeUndefined();
		expect(document.querySelector('[role=menu]')).not.toBeNull();
		item.click();
		await flushPromises();
		expect(wrapper.emitted('select')).toEqual([['pin']]);
	} finally {
		wrapper.unmount();
	}
});

it('keeps a touch long-press menu open when focus returns to its trigger on release', async () => {
	vi.useFakeTimers();
	const wrapper = mount(UiContextMenu, {
		attachTo: document.body,
		props: { items: [{ id: 'pin', label: 'Pin' }] },
		slots: { default: '<button>Application</button>' },
	});
	try {
		wrapper.find('button').element.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				pointerType: 'touch',
				clientX: 50,
				clientY: 40,
			}),
		);
		await nextTick();
		await vi.advanceTimersByTimeAsync(701);
		expect(document.querySelector('[role="menu"]')).not.toBeNull();
		wrapper
			.find('button')
			.element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
		wrapper.find('button').element.focus();
		await nextTick();
		expect(document.querySelector('[role="menu"]')).not.toBeNull();
	} finally {
		wrapper.unmount();
		vi.useRealTimers();
	}
});
