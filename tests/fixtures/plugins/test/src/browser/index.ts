import type { PluginContextApi } from 'nexus-terminal/browser';
import CounterView from './CounterView.vue';

declare module 'nexus-terminal/browser' {
	interface PluginServicesApi {
		'@nexus-terminal/test': { sample: { name(): string } };
	}
}

export function activate(context: PluginContextApi): void {
	context.provide('sample', { name: () => 'sample' });
	context.app.log.registerMessages({
		en: { TEST_COUNTER_INCREMENTED: 'Saved {count} item(s).' },
		zh: { TEST_COUNTER_INCREMENTED: '已保存 {count} 项。' },
	});
	context.contribute({
		applications: [
			{
				id: 'counter',

				label: (locale) => (locale === 'zh' ? '计数器' : 'Counter'),

				component: CounterView,
			},
		],
		widgets: [{ id: 'counter', label: 'Counter Widget', component: CounterView }],
	});
	context.onDispose(() => {
		window.dispatchEvent(new CustomEvent('nexus:test:lifecycle', { detail: 'plugin-disposed' }));
	});
	context.self.readiness.set({ state: 'ready' });
	window.dispatchEvent(new CustomEvent('nexus:test:lifecycle', { detail: 'activated' }));
}

export function deactivate(context: PluginContextApi): void {
	if (!context.signal.aborted) throw new Error('PLUGIN_SCOPE_STILL_ACTIVE');
	window.dispatchEvent(new CustomEvent('nexus:test:lifecycle', { detail: 'deactivated' }));
}
