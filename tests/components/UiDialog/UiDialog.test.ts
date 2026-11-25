import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick, type Plugin } from 'vue';
import { createI18n } from 'vue-i18n';
import UiDialog from '../../../src/ui/browser/components/UiDialog.vue';

const wrappers: VueWrapper[] = [];

beforeEach(() => {
	localStorage.clear();
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 120, 560, 400));
	vi.stubGlobal('innerWidth', 1440);
	vi.stubGlobal('innerHeight', 960);
	vi.spyOn(document.documentElement, 'clientWidth', 'get').mockImplementation(() => window.innerWidth);
	vi.spyOn(document.documentElement, 'clientHeight', 'get').mockImplementation(() => window.innerHeight);
});

afterEach(() => {
	for (const wrapper of wrappers.splice(0)) wrapper.unmount();
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

async function render(props: Partial<InstanceType<typeof UiDialog>['$props']> = {}, i18n?: Plugin) {
	const wrapper = mount(UiDialog, {
		attachTo: document.body,
		global: { plugins: i18n ? [i18n] : [] },
		props: { open: true, title: 'Repository', closeLabel: 'Close', ...props },
		slots: { default: '<input aria-label="Name" />', footer: '<button>Save</button>' },
	});
	wrappers.push(wrapper);
	await flushPromises();
	return wrapper;
}

function dialog() {
	return document.querySelector<HTMLElement>('[data-ui="dialog"]')!;
}

it('keeps the close control in place and rejects user dismissal until work settles', async () => {
	const wrapper = await render({ closeDisabled: true });
	const button = dialog().querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
	expect(button.disabled).toBe(true);
	button.click();
	dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
	await flushPromises();
	expect(wrapper.emitted('update:open')).toBeUndefined();
	await wrapper.setProps({ closeDisabled: false });
	expect(dialog().querySelector('button[aria-label="Close"]')).toBe(button);
	expect(button.disabled).toBe(false);
	button.click();
	await flushPromises();
	expect(wrapper.emitted('update:open')).toEqual([[false]]);
});

it('uses one gutter policy for scrolling content and fixed header and footer', async () => {
	const wrapper = await render({ gutter: 'auto' });

	const gutters = () =>
		[...dialog().querySelectorAll('[data-scrollbar-gutter]')].map((element) =>
			element.getAttribute('data-scrollbar-gutter'),
		);

	expect(gutters()).toEqual(['auto', 'auto', 'auto']);
	await wrapper.setProps({ gutter: 'symmetric' });
	expect(gutters()).toEqual(['symmetric', 'symmetric', 'symmetric']);
});

it('enables resize by default without fixing natural dimensions and supports opting out and fullscreen', async () => {
	const wrapper = await render();
	expect(dialog().hasAttribute('data-geometry')).toBe(true);
	expect(document.querySelector('[data-ui="resize-handle"]')).not.toBeNull();
	expect(dialog().style.width).toBe('');
	expect(dialog().style.height).toBe('');
	await wrapper.setProps({ resizable: false });
	expect(dialog().hasAttribute('data-geometry')).toBe(false);
	expect(document.querySelector('[data-ui="resize-handle"]')).toBeNull();
	await wrapper.setProps({ resizable: true });
	await wrapper.setProps({ size: 'fullscreen' });
	await flushPromises();
	expect(dialog().hasAttribute('data-geometry')).toBe(false);
	expect(dialog().style.width).toBe('');
});

it('distinguishes the resize handle from a destructive action and localizes its name', async () => {
	const i18n = createI18n({
		legacy: false,
		locale: 'en',
		messages: {
			en: { desktop: { resize: 'Resize {title}' } },
			zh: { desktop: { resize: '调整{title}大小' } },
		},
	});
	const wrapper = await render({ title: 'Delete' }, i18n);

	const handle = () => dialog().querySelector('[data-ui="resize-handle"]');

	expect(handle()?.getAttribute('aria-label')).toBe('Resize Delete');
	i18n.global.locale.value = 'zh';
	await wrapper.setProps({ title: '删除' });
	expect(handle()?.getAttribute('aria-label')).toBe('调整删除大小');
	await wrapper.setProps({ resizeLabel: 'Custom size label' });
	expect(handle()?.getAttribute('aria-label')).toBe('Custom size label');
});

it('measures current content on the first resize and does not persist untouched dialogs', async () => {
	await render({ persistenceKey: 'natural-content' });
	expect(localStorage.getItem('nexus.ui.dialog.natural-content')).toBeNull();
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 120, 560, 650));
	expect(dialog().style.height).toBe('');
	const handle = document.querySelector<HTMLButtonElement>('[data-ui="resize-handle"]')!;
	handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
	await flushPromises();
	expect(dialog().style.height).toBe('666px');
	expect(JSON.parse(localStorage.getItem('nexus.ui.dialog.natural-content')!).wide.height).toBe(666);
});

it('resizes unkeyed dialogs without writing shared geometry', async () => {
	await render();
	const handle = document.querySelector<HTMLButtonElement>('[data-ui="resize-handle"]')!;
	handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
	await flushPromises();
	expect(dialog().style.width).toBe('576px');
	expect(localStorage.getItem('nexus.ui.dialog.')).toBeNull();
});

it('resizes by keyboard, restores local geometry after remount and isolates layout profiles', async () => {
	const props = { draggable: true, resizable: true, persistenceKey: 'geometry-test', resizeLabel: 'Resize' };
	const wrapper = await render(props);
	const handle = document.querySelector<HTMLButtonElement>('[data-ui="resize-handle"]')!;
	handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
	await nextTick();
	expect(dialog().style.width).toBe('576px');
	await flushPromises();
	const saved = JSON.parse(localStorage.getItem('nexus.ui.dialog.geometry-test')!);
	expect(saved.wide.width).toBe(576);
	wrapper.unmount();
	wrappers.splice(wrappers.indexOf(wrapper), 1);
	await render(props);
	expect(dialog().style.width).toBe('576px');
	vi.stubGlobal('innerWidth', 390);
	window.dispatchEvent(new Event('resize'));
	await flushPromises();
	// 新分档没有记录，先使用响应式 CSS；首次交互按当前视口裁剪并独立保存。
	expect(dialog().style.width).toBe('');
	document
		.querySelector<HTMLButtonElement>('[data-ui="resize-handle"]')!
		.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
	await flushPromises();
	expect(Number.parseFloat(dialog().style.width)).toBeLessThanOrEqual(358);
	expect(Number.parseFloat(dialog().style.left)).toBeGreaterThanOrEqual(16);
	vi.stubGlobal('innerWidth', 1440);
	window.dispatchEvent(new Event('resize'));
	await flushPromises();
	expect(dialog().style.width).toBe('576px');
});

it('reports invalid storage and still opens and resizes without persistence', async () => {
	localStorage.setItem('nexus.ui.dialog.invalid-test', '{invalid');
	const wrapper = await render({ resizable: true, persistenceKey: 'invalid-test' });
	expect(wrapper.emitted('storageError')).toHaveLength(1);
	expect(dialog().style.width).toBe('');
	const handle = document.querySelector<HTMLButtonElement>('[data-ui="resize-handle"]')!;
	for (let i = 0; i < 10; i++)
		handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
	await flushPromises();
	expect(dialog().style.width).toBe('320px');
	expect(dialog().querySelector('button')?.isConnected).toBe(true);
});
