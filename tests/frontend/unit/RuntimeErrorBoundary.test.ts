// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import i18n from '@/app/i18n';
import RuntimeErrorBoundary from '@/shared/feedback/components/RuntimeErrorBoundary.vue';

describe('RuntimeErrorBoundary', () => {
  it('isolates a descendant render failure and remounts it on retry', async () => {
    let shouldThrow = true;
    const Child = {
      name: 'ThrowingChild',
      render() {
        if (shouldThrow) throw new Error('boom');
        return null;
      },
    };

    const wrapper = mount(RuntimeErrorBoundary, {
      props: { scope: 'test' },
      slots: { default: Child as any },
      global: { plugins: [i18n] },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="runtime-error-boundary"]').attributes('data-runtime-boundary')).toBe('test');
    expect(wrapper.text()).toContain('An error occurred.');

    shouldThrow = false;
    await wrapper.get('button').trigger('click');

    expect(wrapper.find('[data-testid="runtime-error-boundary"]').exists()).toBe(false);
  });

  it('clears a captured failure when resetKey changes', async () => {
    let shouldThrow = true;
    const Child = {
      render() {
        if (shouldThrow) throw new Error('boom');
        return null;
      },
    };

    const wrapper = mount(RuntimeErrorBoundary, {
      props: { scope: 'test', resetKey: 'a' },
      slots: { default: Child as any },
      global: { plugins: [i18n] },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="runtime-error-boundary"]').exists()).toBe(true);
    shouldThrow = false;
    await wrapper.setProps({ resetKey: 'b' });

    expect(wrapper.find('[data-testid="runtime-error-boundary"]').exists()).toBe(false);
  });
});
