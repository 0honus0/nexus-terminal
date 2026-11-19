import { expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import UiResizeHandle from '../../../src/ui/browser/components/UiResizeHandle.vue';
import { uiResizeEdges } from '../../../src/ui/browser/ui-components-api.js';

it('opts into explicit outer edges without adding keyboard stops and forwards attributes to the corner button', async () => {
	const wrapper = mount(UiResizeHandle, {
		props: { label: 'Resize' },
		attrs: { class: 'corner', id: 'panel-resize' },
	});
	try {
		expect(wrapper.find('.ui-resize-edges').exists()).toBe(false);
		await wrapper.setProps({ edges: true });
		const frame = wrapper.get('.ui-resize-edges');
		expect(frame.attributes('aria-hidden')).toBe('true');
		expect(frame.findAll('span')).toHaveLength(7);
		for (const selector of Object.values(uiResizeEdges))
			expect(wrapper.findAll(selector).length).toBeGreaterThan(0);
		expect(wrapper.findAll('button')).toHaveLength(1);
		expect(wrapper.get('button').attributes('id')).toBe('panel-resize');
		expect(wrapper.get('button').classes()).toContain('corner');
	} finally {
		wrapper.unmount();
	}
});

it('handles arrow keys without triggering desktop navigation and leaves other keys alone', async () => {
	const bubbled = vi.fn();
	const parent = document.createElement('div');
	parent.addEventListener('keydown', bubbled);
	document.body.append(parent);
	const wrapper = mount(UiResizeHandle, { attachTo: parent, props: { label: 'Resize' } });
	try {
		for (const [key, shiftKey] of [
			['ArrowRight', false],
			['ArrowLeft', false],
			['ArrowUp', true],
			['ArrowDown', true],
		] as const) {
			const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
			wrapper.get('button').element.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(true);
		}
		expect(wrapper.emitted('resize')).toEqual([
			[16, 0],
			[-16, 0],
			[0, -48],
			[0, 48],
		]);
		expect(bubbled).not.toHaveBeenCalled();
		await wrapper.get('button').trigger('keydown', { key: 'Escape' });
		expect(bubbled).toHaveBeenCalledOnce();
		expect(wrapper.emitted('resize')).toHaveLength(4);
	} finally {
		wrapper.unmount();
		parent.remove();
	}
});
