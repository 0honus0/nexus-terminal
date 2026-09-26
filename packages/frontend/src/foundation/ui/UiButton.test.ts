// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import UiButton from './UiButton.vue';

describe('UiButton', () => {
  it('blocks activation and reports busy state while loading', async () => {
    const wrapper = mount(UiButton, { props: { loading: true }, slots: { default: 'Save' } });
    const button = wrapper.get('button');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('.ui-button__spinner').exists()).toBe(true);

    await wrapper.setProps({ loading: false });
    expect(button.attributes('disabled')).toBeUndefined();
    expect(button.attributes('aria-busy')).toBeUndefined();
    expect(button.text()).toBe('Save');
  });
});
