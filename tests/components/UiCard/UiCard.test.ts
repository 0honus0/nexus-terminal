import { expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import UiCard from '../../../src/ui/browser/components/UiCard.vue';
it('separates the primary action from menu controls and keeps disabled content visible', async () => {
	const wrapper = mount(UiCard, {
		props: { title: 'Server', description: 'host:22' },
		slots: { tags: 'Production', badge: 'SSH', actions: '<button>Actions</button>' },
	});
	await wrapper.get('.ui-card__actions button').trigger('click');
	expect(wrapper.emitted('select')).toBeUndefined();
	await wrapper.get('.ui-card__main').trigger('click');
	expect(wrapper.emitted('select')).toHaveLength(1);
	await wrapper.setProps({ disabled: true });
	await wrapper.get('.ui-card__main').trigger('click');
	expect(wrapper.emitted('select')).toHaveLength(1);
	expect(wrapper.text()).toContain('Production');
	expect(wrapper.find('button button').exists()).toBe(false);
	wrapper.unmount();
});

it('copies selected card text without opening it, while keyboard and ordinary clicks still activate it', async () => {
	const wrapper = mount(UiCard, { attachTo: document.body, props: { title: 'Server', description: 'host:22' } });
	const selection = document.getSelection()!;
	try {
		const range = document.createRange();
		range.selectNodeContents(wrapper.get('.ui-card__description').element);
		selection.removeAllRanges();
		selection.addRange(range);
		wrapper.get('.ui-card__main').element.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
		expect(selection.toString()).toBe('host:22');
		expect(wrapper.emitted('select')).toBeUndefined();
		wrapper
			.get('.ui-card__main')
			.element.dispatchEvent(new PointerEvent('pointerdown', { button: 2, isPrimary: true, bubbles: true }));
		expect(selection.toString()).toBe('host:22');
		await wrapper.get('.ui-card__main').trigger('click');
		expect(wrapper.emitted('select')).toHaveLength(1);
		wrapper
			.get('.ui-card__main')
			.element.dispatchEvent(new PointerEvent('pointerdown', { button: 0, isPrimary: true, bubbles: true }));
		expect(selection.isCollapsed).toBe(true);
		wrapper.get('.ui-card__main').element.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
		expect(wrapper.emitted('select')).toHaveLength(2);
	} finally {
		selection.removeAllRanges();
		wrapper.unmount();
	}
});

it('does not suppress actions because text elsewhere is selected', async () => {
	const other = document.createElement('p');
	other.textContent = 'Other content';
	document.body.append(other);
	const wrapper = mount(UiCard, { attachTo: document.body, props: { title: 'Server' } });
	const selection = document.getSelection()!;
	try {
		const range = document.createRange();
		range.selectNodeContents(other);
		selection.removeAllRanges();
		selection.addRange(range);
		wrapper.get('.ui-card__main').element.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
		expect(wrapper.emitted('select')).toHaveLength(1);
	} finally {
		selection.removeAllRanges();
		wrapper.unmount();
		other.remove();
	}
});

it('keeps footer actions available when the primary content is disabled', async () => {
	const wrapper = mount(UiCard, {
		props: { title: 'Unavailable app', disabled: true },
		slots: { footer: '<button>Update</button>' },
	});
	try {
		await wrapper.get('.ui-card__footer button').trigger('click');
		expect(wrapper.emitted('select')).toBeUndefined();
		expect(wrapper.get('.ui-card__footer button').attributes('disabled')).toBeUndefined();
		expect(wrapper.find('button button').exists()).toBe(false);
	} finally {
		wrapper.unmount();
	}
});
