import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createApp, h, nextTick, ref, KeepAlive } from 'vue';
import { readSuspendedSessionCatalog } from '@nexus-terminal/shared/remote/suspend/http-codec';
import { setupServer } from 'msw/node';
import { http, HttpResponse, ws } from 'msw';
import { URL as NodeURL } from 'node:url';
import { Blob as NodeBlob } from 'node:buffer';

afterEach(() => vi.unstubAllGlobals());

test('suspended catalog preserves strict requests, unknown writes, late results and view ownership', async () => {
	vi.stubGlobal('URL', NodeURL);
	vi.stubGlobal('Blob', NodeBlob);

	const pinia = createPinia();
	setActivePinia(pinia);
	const { suspendedSessionsApi: api } =
		await import('../../../../packages/frontend/src/features/ssh-suspend/api/suspended-sessions-api.ts');
	const { useSuspendedSessionsStore } =
		await import('../../../../packages/frontend/src/features/ssh-suspend/composables/useSuspendedSessions.ts');
	const { SuspendedRequestFailure } =
		await import('../../../../packages/frontend/src/features/ssh-suspend/model/suspended-session-types.ts');
	const { useDialogStore } = await import('../../../../packages/frontend/src/shared/feedback/store/dialog.store.ts');
	const { useNotificationStore } =
		await import('../../../../packages/frontend/src/shared/feedback/store/notification.store.ts');
	const { authenticatedSessionLifecycle } =
		await import('../../../../packages/frontend/src/shared/session/public.ts');
	const { default: Panel } =
		await import('../../../../packages/frontend/src/features/ssh-suspend/components/SuspendedSessionsPanel.vue');
	const { default: i18n, setLocale } = await import('../../../../packages/frontend/src/app/i18n/index.ts');
	await setLocale('en-US');
	const results = [];

	const expect = (value, label) => {
		if (!value) {
			throw new Error(label);
		}
		results.push(label);
	};

	const json = (body, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

	const make = (id = 'suspend-0001') => ({
		id,
		originalWorkspaceId: 'workspace-0001',
		connectionId: 1,
		connectionName: 'SSH',
		suspendedAt: '2026-10-18T00:00:00.000Z',
		status: 'active',
		ownershipState: 'available',
		ownershipGeneration: 1,
	});

	const gate = () => {
		let resolve;
		const promise = new Promise((done) => {
			resolve = done;
		});
		return { promise, resolve };
	};

	const calls = [];

	let respond = () => json([make()]);

	const sockets = [];
	const catalog = ws.link('ws://localhost/ws/suspended-sessions');
	const server = setupServer(
		catalog.addEventListener('connection', ({ client }) => {
			const peer = {
				push(revision, sessions) {
					client.send(JSON.stringify({ type: 'snapshot', revision, sessions }));
				},
			};
			sockets.push(peer);
			peer.push(1, [make()]);
		}),
		http.all('http://localhost/api/v1/ssh-suspend/*', async ({ request }) => {
			calls.push({ url: request.url, method: request.method });
			try {
				return await respond(request);
			} catch (cause) {
				if (cause instanceof TypeError) return HttpResponse.error();
				throw cause;
			}
		}),
	);
	server.listen({ onUnhandledFrame: 'error' });

	const rejects = async (work, code, label) => {
		let error;
		try {
			await work();
		} catch (cause) {
			error = cause;
		}
		expect(error instanceof SuspendedRequestFailure && error.code === code, label);
		return error;
	};

	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

	const store = useSuspendedSessionsStore();
	let app;
	let container;
	try {
		const sessions = await api.list();
		expect(
			sessions[0].id === make().id && sessions[0].suspendedAt === make().suspendedAt,
			'catalog maps canonical ISO timestamp and application identity',
		);
		for (const [row, label] of [
			[{ ...make(), secret: 'private' }, 'extra private fields rejected'],
			[{ ...make(), ownershipState: 'attached' }, 'attached without lease rejected'],
			[{ ...make(), status: 'disconnected' }, 'disconnected missing timestamp rejected'],
			[{ ...make(), suspendedAt: '2026-10-18' }, 'noncanonical timestamp rejected'],
			[{ ...make(), customName: ' untrimmed ' }, 'noncanonical response name rejected'],
			[{ ...make(), connectionName: '\ud800' }, 'malformed Unicode rejected'],
		]) {
			respond = () => json([row]);
			await rejects(() => api.list(), 'protocol_failure', label);
		}
		let failed = false;
		try {
			readSuspendedSessionCatalog([make(), make()]);
		} catch {
			failed = true;
		}
		expect(failed, 'duplicate catalog identities rejected');
		respond = () => json(Array.from({ length: 65 }, (_, i) => make('suspend-' + String(i).padStart(4, '0'))));
		expect((await api.list()).length === 65, 'catalog cardinality follows its complete byte budget');
		let count = calls.length;
		await rejects(() => api.rename('../invalid', 'name'), 'invalid_input', 'invalid ID rejected');
		await rejects(() => api.rename(make().id, 'x'.repeat(129)), 'invalid_input', 'name length rejected');
		expect(calls.length === count, 'invalid requests never dispatch');
		respond = () => json({ message: 'Suspended session name updated.', customName: 'different' });
		await rejects(
			() => api.rename(make().id, 'expected'),
			'protocol_failure',
			'rename response correlated to requested name',
		);
		respond = () => json({ code: 'forbidden' }, 403);
		const refusal = await rejects(() => api.remove(make().id), 'forbidden', 'finite safe refusal decoded');
		expect(refusal.outcome === 'confirmed', 'safe refusal is a confirmed result');
		respond = () => json({ code: 'forbidden' }, 503);
		await rejects(() => api.remove(make().id), 'protocol_failure', 'failure status and code must agree');
		respond = () => json({ code: 'forbidden', message: 'internal secret' }, 403);
		await rejects(() => api.remove(make().id), 'protocol_failure', 'arbitrary error prose rejected');
		respond = () => json([make()]);
		await store.load({ force: true });
		const late = gate();
		respond = () => late.promise;
		const pending = store.load({ force: true });
		await tick();
		store.resetSuspendedSessionsCatalog();
		respond = () => json([make('suspend-0002')]);
		await store.load({ force: true });
		late.resolve(json([make()]));
		await pending;
		expect(store.sessions[0].id === 'suspend-0002', 'late catalog cannot overwrite a new login epoch');
		count = calls.length;
		const queued = store.load({ force: true });
		store.resetSuspendedSessionsCatalog();
		await queued;
		expect(calls.length === count, 'reset before queued dispatch prevents old GET');
		respond = () => json([make()]);
		await store.load({ force: true });
		respond = () => {
			throw new TypeError('lost response');
		};
		await store.load({ force: true });
		expect(
			store.error === 'sshSuspend.errors.request_failed' && !store.blockedIds.size && store.sessions.length === 1,
			'failed catalog read preserves entries without claiming an unknown mutation or blocking writes',
		);
		await rejects(
			() => store.rename(store.sessions[0], 'new'),
			'request_failed',
			'lost mutation response becomes unknown',
		);
		expect(store.blockedIds.has(make().id), 'unknown blocks another write to the same session');
		count = calls.length;
		await rejects(() => store.remove(store.sessions[0]), 'conflict', 'unknown write cannot be repeated');
		expect(calls.length === count, 'unknown intent never automatically replays');
		respond = () => json([make()]);
		await store.load({ force: true, silent: true });
		expect(store.blockedIds.has(make().id), 'ordinary read/poll does not clear unknown protection');
		await store.recover();
		expect(!store.blockedIds.size, 'explicit successful read-back permits user verification');
		const reading = gate();
		respond = () => reading.promise;
		const recovery = store.recover();
		await tick();
		respond = () => {
			throw new TypeError('new unknown');
		};
		await rejects(
			() => store.rename(store.sessions[0], 'another'),
			'request_failed',
			'concurrent mutation can become unknown during read-back',
		);
		reading.resolve(json([make()]));
		await recovery;
		expect(store.blockedIds.has(make().id), 'older recovery cannot clear a newer unknown intent');
		store.resetSuspendedSessionsCatalog();
		let cancelled = false;
		respond = () =>
			new Response(
				new ReadableStream({
					start(c) {
						c.enqueue(new Uint8Array([65]));
					},

					cancel() {
						cancelled = true;
					},
				}),
				{ headers: { 'Content-Type': 'application/octet-stream' } },
			);
		await rejects(
			() => api.exportLog(make().id),
			'protocol_failure',
			'invalid log headers rejected before full download',
		);
		expect(cancelled, 'rejected response body is cancelled');
		let clicks = 0;
		const originalClick = HTMLAnchorElement.prototype.click;
		HTMLAnchorElement.prototype.click = () => {
			clicks++;
		};
		try {
			respond = () =>
				new Response('log text', {
					headers: {
						'Content-Type': 'text/plain; charset=utf-8',
						'Content-Disposition': 'attachment; filename="' + make().id + '.txt"',
					},
				});
			expect(
				(await store.exportLog(make().id)) === make().id + '.txt' && clicks === 1,
				'validated log delivered with safe fixed filename',
			);
			const download = gate();
			respond = () => download.promise;
			const exporting = store.exportLog(make().id);
			await tick();
			store.resetSuspendedSessionsCatalog();
			download.resolve(
				new Response('late log', {
					headers: {
						'Content-Type': 'text/plain; charset=utf-8',
						'Content-Disposition': 'attachment; filename="' + make().id + '.txt"',
					},
				}),
			);
			let aborted = false;
			try {
				await exporting;
			} catch {
				aborted = true;
			}
			expect(aborted && clicks === 1, 'session reset prevents late log download');
		} finally {
			HTMLAnchorElement.prototype.click = originalClick;
		}
		respond = () => json([make()]);
		const visible = ref(true);
		await store.load({ force: true });
		container = document.createElement('div');
		document.body.appendChild(container);
		app = createApp({ render: () => h(KeepAlive, null, { default: () => (visible.value ? h(Panel) : null) }) });
		app.use(pinia);
		app.use(i18n);
		app.mount(container);
		await tick();
		await nextTick();
		const remove = container.querySelector('.action-remove');
		expect(remove !== null, 'formal panel renders catalog record');
		count = calls.length;
		sockets.at(-1).push(2, [{ ...make(), customName: 'external rename' }]);
		await nextTick();
		expect(
			calls.length === count && store.sessions[0].customName === 'external rename',
			'WS snapshot changes shared directory without HTTP',
		);
		sockets.at(-1).push(1, [make()]);
		await nextTick();
		expect(
			store.sessions[0].customName === 'external rename',
			'older connection revision does not overwrite latest directory',
		);
		remove.click();
		await nextTick();
		expect(useDialogStore().state.visible, 'remove opens a confirmation before dispatch');
		count = calls.length;
		visible.value = false;
		await nextTick();
		useDialogStore().accept();
		await tick();
		expect(
			calls.length === count && !useDialogStore().state.visible,
			'KeepAlive deactivation cancels confirmation and dispatch',
		);
		visible.value = true;
		await tick();
		await nextTick();
		expect(container.querySelector('.action-remove') !== null, 'KeepAlive reactivation reloads the panel');
		const oldCount = calls.length;
		respond = () => json({ code: 'forbidden' }, 403);
		await store.load({ force: true });
		await nextTick();
		expect(
			container.querySelector('.action-remove') !== null &&
				container.querySelector('[role=alert]') === null &&
				useNotificationStore().notifications.some((item) => item.message.includes('Permission denied')) &&
				container.querySelector('button[aria-label="Read latest state and verify"]') !== null,
			'read failure preserves entries, uses a finite localized Toast and retains read-back access',
		);
		expect(calls.length === oldCount + 1, 'read failure has no implicit retry');
		respond = () => json([make()]);
		await store.recover();
		await nextTick();
		container.querySelector('.action-remove').click();
		await nextTick();
		authenticatedSessionLifecycle.attach(1);
		count = calls.length;
		authenticatedSessionLifecycle.logout();
		useDialogStore().accept();
		await tick();
		expect(
			calls.length === count && store.sessions.length === 0,
			'logout cancels pending view confirmation and clears catalog',
		);
		assert.ok(results.length >= 35);
	} finally {
		app?.unmount();
		container?.remove();
		store.resetSuspendedSessionsCatalog();
		server.close();
	}
});
