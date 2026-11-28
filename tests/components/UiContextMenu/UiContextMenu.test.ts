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

it('consumes the click following a touch long press and preserves ordinary taps', async () => {
	const clicked = vi.fn();
	const wrapper = mount(UiContextMenu, {
		attachTo: document.body,
		props: { items: [{ id: 'pin', label: 'Pin' }] },
		slots: { default: '<button>Application</button>' },
	});
	try {
		const button = wrapper.find('button').element;
		button.addEventListener('click', clicked);
		const touch = {
			bubbles: true,
			cancelable: true,
			pointerType: 'touch',
			pointerId: 4,
			isPrimary: true,
			clientX: 50,
			clientY: 40,
		};
		button.dispatchEvent(new PointerEvent('pointerdown', touch));
		await wrapper.find('button').trigger('contextmenu', { clientX: 50, clientY: 40 });
		await flushPromises();
		expect(document.querySelector('[role="menu"]')).not.toBeNull();
		button.dispatchEvent(new PointerEvent('pointerup', touch));
		const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		button.dispatchEvent(mouseDown);
		expect(mouseDown.defaultPrevented).toBe(true);
		button.dispatchEvent(new PointerEvent('click', { ...touch, detail: 1 }));
		expect(clicked).not.toHaveBeenCalled();
		await nextTick();
		const item = document.querySelector<HTMLElement>('[role="menuitem"]')!;
		item.click();
		expect(wrapper.emitted('select')).toEqual([['pin']]);
		button.dispatchEvent(new PointerEvent('pointerdown', touch));
		button.dispatchEvent(new PointerEvent('pointerup', touch));
		button.dispatchEvent(new PointerEvent('click', { ...touch, detail: 1 }));
		expect(clicked).toHaveBeenCalledOnce();
	} finally {
		wrapper.unmount();
	}
});
