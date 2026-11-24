import { randomUUID } from 'node:crypto';
import { chromium, test as base, type WebSocketRoute } from '@playwright/test';
import { marketplaceFrontendBase } from '../../src/marketplace/marketplace-http-types.js';
import {
	MarketplaceFrontendsTopic,
	MarketplaceOperationsTopic,
	MarketplacePluginId,
	type MarketplaceOperation,
} from '../../src/marketplace/marketplace-types.js';
import { PluginRuntimeStateTopic, type PluginRuntimeInfo } from '../../src/plugin/plugin-state-types.js';
import { settingsBase } from '../../src/settings/settings-http-types.js';
import { defaultSettings, SettingsPatchSchema, SettingsTopic } from '../../src/settings/settings-types.js';
import { StateCommandSchema, stateTopicKey, type StateTopic } from '../../src/state/state-ws-types.js';
import manifest from '../fixtures/plugins/test/package.json' with { type: 'json' };

export { expect } from '@playwright/test';

interface HostFixture {
	setPluginVersion(version: string | null): void;
	setOperations(operations: MarketplaceOperation[]): void;
	setRuntime(runtime: PluginRuntimeInfo[]): void;
}

const cdp = process.env.NEXUS_TEST_CDP;
const runner = cdp
	? base.extend({
			browser: [
				async ({}, use) => {
					const browser = await chromium.connectOverCDP(cdp);
					try {
						await use(browser);
					} finally {
						await browser.close();
					}
				},
				{ scope: 'worker' },
			],
		})
	: base;

export const test = runner.extend<{ host: HostFixture }>({
	async host({ page }, use) {
		const market = '/api/plugins/' + encodeURIComponent(MarketplacePluginId);
		const entry = marketplaceFrontendBase + '/' + encodeURIComponent(manifest.name);
		let preferences = { revision: 1, preferences: { ...defaultSettings } };
		let version: string | null = manifest.version;
		let operations: MarketplaceOperation[] = [];
		let runtime: PluginRuntimeInfo[] = [];
		let socket: WebSocketRoute | undefined;
		const subscribed = new Set<string>();
		const topics = new Map<string, { instanceId: string; revision: number }>();

		function publish(topic: StateTopic, state: unknown): void {
			const key = stateTopicKey(topic);
			if (!subscribed.has(key)) return;
			const cursor = topics.get(key) ?? { instanceId: randomUUID(), revision: 0 };
			cursor.revision++;
			topics.set(key, cursor);
			socket?.send(JSON.stringify({ type: 'snapshot', topic, ...cursor, state }));
		}

		function publishPlugins(): void {
			publish(
				MarketplaceFrontendsTopic,
				version
					? [
							{
								pluginId: manifest.name,
								version,
								dependsOn: {},
								hasBackend: false,
								entryURL: entry + '/' + version + '/index.js',
							},
						]
					: [],
			);
		}

		await page.route('**/api/auth/state', (route) =>
			route.fulfill({ json: { initialized: true, account: { id: 'owner', username: 'test' }, methods: [] } }),
		);
		await page.route('**' + settingsBase, async (route) => {
			if (route.request().method() === 'PATCH') {
				const patch = SettingsPatchSchema.parse(route.request().postDataJSON());
				preferences = {
					revision: preferences.revision + 1,
					preferences: { ...preferences.preferences, ...patch },
				};
				publish(SettingsTopic, preferences);
			}
			await route.fulfill({ json: preferences });
		});
		for (const path of [
			'/repositories',
			'/plugins',
			'/manager/plugins',
			'/manager/operations',
			'/manager/retained-data',
			'/manager/install-attempts',
		])
			await page.route('**' + market + path, (route) => route.fulfill({ json: { items: [] } }));

		await page.route('**' + entry + '/*/index.js', (route) =>
			route.fulfill({
				contentType: 'text/javascript',
				body:
					"export * from '/@fs" +
					new URL('../fixtures/plugins/test/src/browser/index.ts', import.meta.url).pathname +
					"';",
			}),
		);
		await page.routeWebSocket('**/api/state/ws', (client) => {
			socket = client;
			subscribed.clear();
			client.onMessage((raw) => {
				const { type, topic } = StateCommandSchema.parse(JSON.parse(String(raw)));
				const key = stateTopicKey(topic);
				if (type === 'unsubscribe') {
					subscribed.delete(key);
					return;
				}
				subscribed.add(key);
				if (key === stateTopicKey(MarketplaceFrontendsTopic)) publishPlugins();
				else if (key === stateTopicKey(SettingsTopic)) publish(topic, preferences);
				else if (key === stateTopicKey(PluginRuntimeStateTopic)) publish(topic, runtime);
				else if (key === stateTopicKey(MarketplaceOperationsTopic)) publish(topic, operations);
			});
		});
		await use({
			setPluginVersion(next) {
				version = next;
				publishPlugins();
			},

			setOperations(next) {
				operations = next;
				publish(MarketplaceOperationsTopic, operations);
			},

			setRuntime(next) {
				runtime = next;
				publish(PluginRuntimeStateTopic, runtime);
			},
		});
	},
});
