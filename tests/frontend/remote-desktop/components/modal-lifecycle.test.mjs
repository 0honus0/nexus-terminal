import { test, expect, vi, onTestFinished } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import Modal from '../../../../packages/frontend/src/features/remote-desktop/components/RemoteDesktopModal.vue';
import { remoteDesktopApi } from '../../../../packages/frontend/src/features/remote-desktop/api/remote-desktop-api.ts';
import * as browserDesktop from '../../../../packages/frontend/src/features/remote-desktop/adapters/browser-desktop.ts';
import { authenticatedSessionLifecycle } from '../../../../packages/frontend/src/shared/session/public.ts';

test('formal desktop modal emits the connected target only after its real controller callback, translates and retires on identity disposal', async () => {
	// No protocol or pixels are claimed here; real adapters and transports run in the product browser journey.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}

			unobserve() {}

			disconnect() {}
		},
	);
	const issued = Promise.withResolvers();
	const create = vi.spyOn(remoteDesktopApi, 'create').mockReturnValue(issued.promise);
	const peers = [];
	vi.spyOn(browserDesktop, 'createBrowserDesktop').mockImplementation((options) => {
		const peer = {
			element: document.createElement('div'),
			options,
			connect: vi.fn(),
			resize: vi.fn(),
			focus: vi.fn(),
			setTouchMode: vi.fn(),
			setTextInputActive: vi.fn(),

			syncClipboard: async () => {},

			sendText: vi.fn(),
			close: vi.fn(),
		};
		peer.close.mockImplementation(() => peer.element.remove());
		peers.push(peer);
		return peer;
	});
	const additions = vi.spyOn(window, 'addEventListener');
	const removals = vi.spyOn(window, 'removeEventListener');
	const node = document.createElement('div');
	document.body.append(node);
	await setLocale('en-US');
	const panel = mount(Modal, {
		attachTo: node,
		props: { visible: true, connection: { id: 17, type: 'VNC', name: 'Formal desktop' } },
		global: { plugins: [createPinia(), i18n] },
	});
	onTestFinished(async () => {
		try {
			panel.unmount();
			for (const [kind, listener, options] of additions.mock.calls.filter(([kind]) => kind === 'keydown')) {
				expect(
					removals.mock.calls.some(
						([type, removed, flags]) => type === kind && removed === listener && flags === options,
					),
				).toBe(true);
			}
		} finally {
			node.remove();
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
			await setLocale('en-US');
		}
	});
	await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
	expect(panel.emitted('connected')).toBeUndefined();
	expect(peers).toHaveLength(0);
	issued.resolve({
		ticket: 'A'.repeat(43),
		protocol: 'VNC',
		host: '127.0.0.1',
		port: 5900,
		username: '',
		password: 'test',
	});
	await vi.waitFor(() => expect(peers).toHaveLength(1));
	expect(panel.emitted('connected')).toBeUndefined();
	const peer = peers[0];
	expect(document.body.contains(peer.element)).toBe(true);
	peer.options.onState('connected');
	await nextTick();
	expect(panel.emitted('connected')).toEqual([[17]]);
	for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
		await setLocale(locale);
		await nextTick();
		expect(document.body.textContent).not.toContain('remoteDesktopModal.');
		expect(document.body.textContent).toContain(i18n.global.t('remoteDesktopModal.status.connected'));
	}
	expect(authenticatedSessionLifecycle.dispose().failures).toEqual([]);
	await nextTick();
	expect(peer.close).toHaveBeenCalledTimes(1);
	expect(document.body.contains(peer.element)).toBe(false);
	expect(create).toHaveBeenCalledTimes(1);
	expect(panel.emitted('connected')).toEqual([[17]]);
});
