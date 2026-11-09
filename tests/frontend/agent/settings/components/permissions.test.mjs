import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import i18n, { setLocale } from '../../../../../packages/frontend/src/app/i18n/index.ts';
import PluginCapabilities from '../../../../../packages/frontend/src/features/agent/plugins/components/PluginCapabilities.vue';
import { AGENT_CAPABILITIES } from '../../../../../packages/shared/src/agent/governance/values.ts';

await setLocale('en-US');

function render(props) {
	return mount(PluginCapabilities, { props, global: { plugins: [i18n] } });
}

test('all declared capabilities have translated grouped details collapsed by default', () => {
	const wrapper = render({ capabilities: [...AGENT_CAPABILITIES] });
	expect(wrapper.findAll('details')).toHaveLength(6);
	expect(wrapper.findAll('details').every((item) => !item.element.open)).toBe(true);
	expect(
		wrapper
			.findAll('code')
			.map((item) => item.text())
			.sort(),
	).toEqual([...AGENT_CAPABILITIES].sort());
	expect(wrapper.findAll('[role="checkbox"]')).toHaveLength(0);
	expect(wrapper.text()).not.toContain('agent.settings.apps.capabilities.');
	wrapper.unmount();
});

test('editable grouping preserves individual grant selection and blocks disabled changes', async () => {
	const wrapper = render({
		capabilities: ['file.read', 'file.write', 'plugin.configure'],
		granted: ['file.read'],
		editable: true,
	});
	const inputs = wrapper.findAll('[role="checkbox"]');
	expect(inputs.map((item) => item.attributes('aria-checked') === 'true')).toEqual([true, false, false]);
	await inputs[1].trigger('click');
	expect(wrapper.emitted('change')).toEqual([['file.write', true]]);
	await wrapper.setProps({ disabled: true });
	expect(inputs.every((item) => item.attributes('disabled') !== undefined)).toBe(true);
	wrapper.unmount();
});
