import { test, expect, onTestFinished } from 'vitest';
import { h } from 'vue';
import { mount as mountComponent } from '@vue/test-utils';
import { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import { openTargetPanel } from '../../targets/support/panel.mjs';
import { connectionsApi } from '../../../../packages/frontend/src/features/connections/api/connections-api.ts';
import { useConnectionsStore } from '../../../../packages/frontend/src/features/connections/store/connections.store.ts';
import { useTagsStore } from '../../../../packages/frontend/src/features/tags/store/tags.store.ts';
import { useConnectionManagement } from '../../../../packages/frontend/src/features/connections/composables/use-connection-management.ts';

test('connection batches stop on actual unknown commits, recover by read and preserve component cache owners', async () => {
	const { pinia, dialogs, original, check, checks, until, mount, i18n, failure } = await openTargetPanel();
	const connections = useConnectionsStore();
	const tags = useTagsStore();
	await Promise.all([connections.load(), tags.load()]);
	const created = await connections.create({
		connection: {
			name: 'formal connection',
			type: 'SSH',
			host: '127.0.0.1',
			port: 22,
			username: 'user',
			route: 'direct',
			proxyId: null,
			notes: null,
			tagIds: [],
			jumpIds: [],
		},
		tagNames: ['atomic connection tag'],
	});
	expect(created[0].status).toBe('ok');
	await connections.load(true);
	const item = await connectionsApi.get(created[0].id);
	const cloned = await connections.clone(item.id, 'second batch clone');
	try {
		let manager;
		const managementUi = mount({
			setup() {
				manager = useConnectionManagement();
				return () => h('div');
			},
		});
		await connections.load(true);
		let writes = 0;
		window.fetch = async (url, options) => {
			if (String(url).includes('/connections/') && options?.method === 'PUT') {
				writes++;
				const committed = await original(url, options);
				expect(committed.status).toBe(200);
				await committed.arrayBuffer();
				throw new TypeError('controlled lost response after actual commit');
			}
			return original(url, options);
		};
		manager.selected.value = new Set([item.id, cloned.id]);
		manager.openBatch();
		await manager.batchSave({ kind: 'metadata', changes: { notes: 'unknown' } });
		check(
			writes === 1 && connections.needsRefresh,
			'batch stops after unknown and does not dispatch remaining mutations',
		);
		await manager.batchSave({ kind: 'metadata', changes: { notes: 'unknown' } });
		check(writes === 1, 'batch unknown cannot be replayed before explicit read recovery');
		window.fetch = original;
		expect((await connectionsApi.get(item.id)).notes).toBe('unknown');
		expect((await connectionsApi.get(cloned.id)).notes).toBeNull();
		await connections.load(true);
		manager.selected.value = new Set([item.id, cloned.id]);
		manager.openBatch();
		await manager.batchSave({ kind: 'metadata', changes: { notes: 'batch confirmed' } });
		check(
			(await connectionsApi.get(item.id)).notes === 'batch confirmed' &&
				(await connectionsApi.get(cloned.id)).notes === 'batch confirmed',
			'real serial metadata batch uses captured snapshots',
		);
		const appendTag = (await tags.ensure(['append connection tag']))[0];
		manager.selected.value = new Set([cloned.id]);
		await manager.data.addTag([cloned.id], appendTag.id);
		await connections.load(true);
		check(
			(await connectionsApi.get(cloned.id)).tagIds.includes(appendTag.id),
			'real append-tag action refreshes full connection cache',
		);
		// Native file export remains in the browser suite.
		const deleteTarget = await connections.clone(item.id, 'batch delete target');
		const deleting = manager.removeMany([deleteTarget]);
		await until(() => dialogs.state.visible);
		dialogs.accept();
		await deleting;
		await failure(() => connectionsApi.get(deleteTarget.id), 'not_found');
		check(true, 'real confirmed batch deletion removes selected resource');
		manager.selected.value = new Set([item.id]);
		manager.openBatch();
		const credentialWait = manager.batchSave({ kind: 'credential', credential: null });
		await until(() => dialogs.state.visible);
		manager.cancelBatch();
		await credentialWait;
		check(
			!dialogs.state.visible && !manager.loading.value,
			'closing batch cancels its pending credential confirmation',
		);
		const { createRouter, createMemoryHistory } = await import('vue-router');
		const router = createRouter({
			history: createMemoryHistory(),
			routes: [{ path: '/', component: { render: () => null } }],
		});
		const { default: ConnectionsView } =
			await import('../../../../packages/frontend/src/features/connections/views/ConnectionsView.vue');
		const viewNode = document.createElement('div');
		document.body.append(viewNode);
		const viewApp = mountComponent(ConnectionsView, {
			attachTo: viewNode,
			global: { plugins: [pinia, i18n, router] },
		});
		onTestFinished(() => {
			if (viewNode.isConnected) {
				try {
					viewApp.unmount();
				} finally {
					viewNode.remove();
				}
			}
		});
		await until(() => viewNode.textContent.includes('formal connection'));
		const more = viewNode.querySelector('button[aria-label="' + i18n.global.t('connections.moreActions') + '"]');
		expect(more).not.toBeNull();
		more.click();
		await until(() =>
			Array.from(document.querySelectorAll('button')).some(
				(button) => button.textContent.trim() === i18n.global.t('connections.exportTitle'),
			),
		);
		check(
			Array.from(document.querySelectorAll('button')).some(
				(button) => button.textContent.trim() === i18n.global.t('connections.exportTitle'),
			),
			'formal Connections view renders the migrated list and export action',
		);
		viewApp.unmount();
		viewNode.remove();
		await tags.load(true);
		const { default: ConnectionTree } =
			await import('../../../../packages/frontend/src/runtimes/workspace/components/WorkspaceConnectionList.vue');
		const tree = mount(ConnectionTree);
		await until(
			() =>
				tree.node.textContent.includes('append connection tag') &&
				tree.node.querySelector('[data-connection-id]'),
		);
		check(
			tree.node.textContent.includes('atomic connection tag'),
			'formal Workspace tree consumes migrated connection/tag owners',
		);
		tree.close();
		let lateConnection;
		onTestFinished(() => lateConnection?.());
		window.fetch = async (url, options) => {
			const result = await original(url, options);
			if (options?.method === 'GET' && String(url).endsWith('/connections')) {
				expect(result.status).toBe(200);
				const body = await result.text();
				await new Promise((resolve) => {
					lateConnection = resolve;
				});
				return new Response(body, { status: result.status, headers: result.headers });
			}
			return result;
		};
		const lateRead = connections.load(true).catch((cause) => cause);
		await until(() => lateConnection);
		connections.reset();
		lateConnection();
		await lateRead;
		check(!connections.loaded && !connections.items.length, 'connection cache reset fences late list delivery');
		window.fetch = original;
		await connections.load(true);
		managementUi.close();
		for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
			await setLocale(locale);
			check(
				i18n.global.te('connections.batchSeparateSaves', locale) &&
					i18n.global.te('connections.testFailures.host_key_untrusted', locale),
				'connection edit and SSH recovery translations: ' + locale,
			);
		}
	} finally {
		globalThis.fetch = original;
	}
	expect(checks).toHaveLength(12);
});
