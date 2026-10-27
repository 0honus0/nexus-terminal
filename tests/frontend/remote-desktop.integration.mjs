import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';
import { openDesktopServices, waitFor } from '../backend/remote/desktop-fixture.mjs';

const { chromium } = createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-desktop-'));
let services;
let app;
let vite;
let browser;
try {
	services = await openDesktopServices();
	const reservation = createNetServer();
	await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
	const port = reservation.address().port;
	await new Promise((resolve, reject) => reservation.close((cause) => (cause ? reject(cause) : resolve())));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'desktop.db'), {
		encryptionKey: randomBytes(32),
	});
	const backend = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: {
			host: '127.0.0.1',
			port,
			strictPort: true,
			proxy: {
				'/api': { target: 'http://' + backend, changeOrigin: false },
				'/ws/remote-desktop': { target: 'ws://' + backend, changeOrigin: false, ws: true },
			},
		},
		plugins: [
			{
				name: 'desktop-fixture',

				resolveId(id) {
					if (id === 'virtual:desktop-fixture') return '\0virtual:desktop-fixture';
				},

				load(id) {
					if (id === '\0virtual:desktop-fixture')
						return `
					export {createApp, h, nextTick, ref} from 'vue';
					export {readRemoteDesktopSessionResponse, readRemoteDesktopFailureResponse} from '@nexus-terminal/shared/remote/desktop/http-codec';
				`;
				},

				configureServer(server) {
					server.middlewares.use('/__desktop', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Desktop fixture</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(origin + '/__desktop');
	await page.evaluate(() => {
		const add = window.addEventListener;
		const remove = window.removeEventListener;
		const blur = new Set();
		window.desktopBlurListeners = blur;
		window.addEventListener = function (type, listener, options) {
			if (type === 'blur') blur.add(listener);
			return add.call(this, type, listener, options);
		};
		window.removeEventListener = function (type, listener, options) {
			if (type === 'blur') blur.delete(listener);
			return remove.call(this, type, listener, options);
		};
	});
	const controlled = await page.evaluate(async () => {
		const { readRemoteDesktopSessionResponse: readSession, readRemoteDesktopFailureResponse: readFailure } =
			await import('/@id/__x00__virtual:desktop-fixture');
		const { remoteDesktopApi } = await import('/src/features/remote-desktop/api/remote-desktop-api.ts');
		const { createRemoteDesktopController } =
			await import('/src/features/remote-desktop/model/remote-desktop-controller.ts');
		const { RemoteDesktopFailure } = await import('/src/features/remote-desktop/model/remote-desktop-types.ts');
		const checks = [];

		const check = (value, name) => {
			if (!value) throw Error(name);
			checks.push(name);
		};

		const rejects = async (action, name, predicate = () => true) => {
			let failure;
			try {
				await action();
			} catch (cause) {
				failure = cause;
			}
			check(failure !== undefined && predicate(failure), name);
		};

		const ticket = 'A'.repeat(43);
		const wire = {
			ticket,
			protocol: 'VNC',
			host: '127.0.0.1',
			port: 5900,
			username: '',
			password: 'private-password',
		};
		check(readSession(wire).ticket === ticket, 'strict successful ticket');
		for (const value of [
			{ ...wire, secret: 'private' },
			{ ...wire, ticket: 'bad' },
			{ ...wire, lastConnectedAt: 1700000000 },
			{ ...wire, ticket: ticket + 'A' },
		]) {
			await rejects(() => readSession(value), 'invalid success refuses extras/ticket');
		}
		for (const value of [{ code: 'remote_unavailable', message: 'secret' }, { code: 'other' }, { code: 401 }])
			await rejects(() => readFailure(value), 'strict safe failure');
		const nativeFetch = window.fetch;
		const display = { width: 800, height: 600, dpi: 96 };
		try {
			window.fetch = async () => Response.json(wire);
			check(
				(await remoteDesktopApi.create(1, 'VNC', display, new AbortController().signal)).ticket === ticket,
				'ticket response carries no attempted connection time',
			);
			window.fetch = async () => Response.json({ code: 'forbidden' }, { status: 503 });
			await rejects(
				() => remoteDesktopApi.create(1, 'VNC', display, new AbortController().signal),
				'status and error must agree',
				(cause) => cause.code === 'protocol_failure' && cause.outcome === 'unknown',
			);
			window.fetch = async () => Response.json({ code: 'operation_unknown' }, { status: 503 });
			await rejects(
				() => remoteDesktopApi.create(1, 'VNC', display, new AbortController().signal),
				'server unknown preserved',
				(cause) => cause.code === 'operation_unknown' && cause.outcome === 'unknown',
			);
			window.fetch = async () =>
				new Response('x'.repeat(65537), { headers: { 'content-type': 'application/json' } });
			await rejects(
				() => remoteDesktopApi.create(1, 'VNC', display, new AbortController().signal),
				'complete response budget enforced',
				(cause) => cause.code === 'protocol_failure',
			);
			window.fetch = async () =>
				new Response(
					new ReadableStream({
						start(stream) {
							stream.error(new Error('private upstream'));
						},
					}),
					{ headers: { 'content-type': 'application/json' } },
				);
			await rejects(
				() => remoteDesktopApi.create(1, 'VNC', display, new AbortController().signal),
				'response failure retains unknown',
				(cause) => cause.outcome === 'unknown',
			);
		} finally {
			window.fetch = nativeFetch;
		}
		const requests = [];
		const peers = [];
		const attempts = [];
		const states = [];
		const owner = createRemoteDesktopController({
			api: {
				create(_id, _protocol, _display, signal) {
					return new Promise((resolve, reject) => requests.push({ resolve, reject, signal }));
				},
			},

			createPeer(options) {
				const peer = {
					element: document.createElement('div'),
					options,
					closes: 0,
					tickets: [],

					connect(value) {
						this.tickets.push(value.ticket);
					},

					resize() {},

					focus() {},

					setTouchMode() {},

					setTextInputActive() {},

					syncClipboard: async () => {},

					sendText() {},

					close() {
						this.closes++;
					},
				};
				peers.push(peer);
				return peer;
			},

			onState(state, failure) {
				states.push({ state, code: failure?.code });
			},

			onConnected(id) {
				attempts.push({ id });
			},
		});
		const target = { id: 1, name: 'test', type: 'VNC' };
		const input = { hasTouch: false, touchMode: 'direct', mobileInput: null };
		const host = document.createElement('div');
		const first = owner.connect(target, display, input, host);
		const second = owner.connect(target, display, input, host);
		requests[0].resolve(wire);
		await first;
		check(
			requests[0].signal.aborted && peers.length === 0 && attempts.length === 0,
			'late cancelled ticket neither opens nor publishes connection',
		);
		requests[1].resolve({ ...wire, ticket: 'B'.repeat(43) });
		await second;
		check(
			peers.length === 1 && attempts.length === 0 && peers[0].tickets[0] === 'B'.repeat(43),
			'new intent receives only its ticket',
		);
		peers[0].options.onState('connected');
		check(attempts.length === 1 && attempts[0].id === target.id, 'only a connected peer requests metadata refresh');
		owner.close();
		const third = owner.connect(target, display, input, host);
		peers[0].options.onFailure(new RemoteDesktopFailure('remote_unavailable', 'unknown'));
		check(states.at(-1).state === 'connecting', 'old peer callback cannot overwrite new attempt');
		requests[2].reject(new RemoteDesktopFailure('request_failed', 'unknown'));
		await third;
		check(
			requests.length === 3 && peers[0].closes === 1 && states.at(-1).code === 'request_failed',
			'unknown attempt is not automatically replayed',
		);
		owner.close();
		const { createRdpDesktop } = await import('/src/features/remote-desktop/adapters/rdp-desktop.ts');
		const { createVncDesktop } = await import('/src/features/remote-desktop/adapters/vnc-desktop.ts');
		const mobile = document.createElement('textarea');
		const subscriptions = new Set();
		const add = mobile.addEventListener.bind(mobile);
		const remove = mobile.removeEventListener.bind(mobile);
		mobile.addEventListener = (type, listener, options) => {
			subscriptions.add(listener);
			return add(type, listener, options);
		};
		mobile.removeEventListener = (type, listener, options) => {
			subscriptions.delete(listener);
			return remove(type, listener, options);
		};
		for (const factory of [createRdpDesktop, createVncDesktop]) {
			for (let count = 0; count < 5; count++) {
				const current = factory({
					hasTouch: true,
					touchMode: 'direct',
					mobileInput: mobile,

					onState() {},

					onFailure(failure) {
						throw failure;
					},
				});
				current.setTouchMode('direct');
				current.setTouchMode('touchpad');
				current.close();
				check(
					subscriptions.size === 0 && window.desktopBlurListeners.size === 0,
					'native peer retires its input listeners ' + count,
				);
			}
		}
		const { attachDesktopTouch } = await import('/src/features/remote-desktop/adapters/desktop-touch.ts');
		for (const mode of ['direct', 'touchpad']) {
			const element = document.createElement('div');
			element.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px';
			const canvas = document.createElement('canvas');
			canvas.width = 200;
			canvas.height = 200;
			element.append(canvas);
			document.body.append(element);
			const calls = [];
			for (const kind of ['mousedown', 'mouseup']) canvas.addEventListener(kind, () => calls.push(kind));
			const touchInput = attachDesktopTouch(element, canvas, mode);
			const touch = new Touch({ identifier: 1, target: element, clientX: 50, clientY: 50 });
			element.dispatchEvent(
				new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch], cancelable: true }),
			);
			element.dispatchEvent(
				new TouchEvent('touchend', { touches: [], changedTouches: [touch], cancelable: true }),
			);
			check(
				calls.includes('mousedown') && calls.includes('mouseup'),
				mode + ' native gesture forwards press and release',
			);
			element.dispatchEvent(
				new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch], cancelable: true }),
			);
			touchInput.close();
			const count = calls.length;
			await new Promise((resolve) => setTimeout(resolve, 550));
			check(
				calls.length === count && element.style.touchAction === '',
				mode + ' retirement cancels pending gesture',
			);
			element.remove();
		}
		const { attachDesktopClipboard } = await import('/src/features/remote-desktop/adapters/desktop-clipboard.ts');
		const failures = [];
		const bridge = attachDesktopClipboard(
			document.createElement('div'),
			async () => {},
			(failure) => failures.push(failure),
		);
		bridge.receive('a'.repeat(1024 * 1024 + 1));
		check(
			failures.length === 1 && failures[0].code === 'input_failed',
			'remote clipboard rejects oversized text without truncation',
		);
		bridge.close();
		bridge.receive('a'.repeat(1024 * 1024 + 1));
		check(failures.length === 1, 'clipboard retirement ignores later data');

		return checks;
	});
	console.log('CONTROLLED', controlled.length, controlled.join('\n'));
	const ids = await page.evaluate(
		async (ports) => {
			const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
			const access = createAccessApi();
			await access.setup({
				username: 'admin',
				password: 'desktop-fixture-123',
				confirmPassword: 'desktop-fixture-123',
			});
			await access.login({ username: 'admin', password: 'desktop-fixture-123' });
			const ids = {};
			for (const type of ['RDP', 'VNC']) {
				const response = await fetch('/api/v1/targets/connections', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						name: 'Frontend ' + type,
						type,
						host: '127.0.0.1',
						port: type === 'RDP' ? ports.rdpPort : ports.vncPort,
						username: 'test',
						route: 'direct',
						proxyId: null,
						notes: null,
						tagIds: [],
						jumpIds: [],
					}),
				});
				if (response.status !== 201) throw Error('create target ' + response.status);
				const target = await response.json();
				const result = await fetch('/api/v1/targets/connections/' + target.id + '/credential', {
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						version: target.version,
						credential: { kind: 'password', password: 'b10-pass' },
					}),
				});
				if (result.status !== 200) throw Error('create credential');
				ids[type] = target.id;
			}
			return ids;
		},
		{ rdpPort: services.rdpPort, vncPort: services.vncPort },
	);
	for (const protocol of ['VNC', 'RDP']) {
		await page.evaluate(
			async ({ id, protocol }) => {
				const { createRemoteDesktopController } =
					await import('/src/features/remote-desktop/model/remote-desktop-controller.ts');
				const { remoteDesktopApi } = await import('/src/features/remote-desktop/api/remote-desktop-api.ts');
				const { createBrowserDesktop } =
					await import('/src/features/remote-desktop/adapters/browser-desktop.ts');
				const host = document.createElement('div');
				host.style.cssText = 'width:800px;height:600px';
				document.body.append(host);
				const fixture = { host, state: '', connectionId: null, failure: null };
				fixture.owner = createRemoteDesktopController({
					api: remoteDesktopApi,
					createPeer: createBrowserDesktop,

					onState(state, failure) {
						fixture.state = state;
						fixture.failure = failure?.code;
					},

					onConnected(id) {
						fixture.connectionId = id;
					},
				});
				window.desktopFixture = fixture;
				await fixture.owner.connect(
					{ id, name: protocol, type: protocol },
					{ width: 800, height: 600, dpi: 96 },
					{ hasTouch: false, touchMode: 'direct', mobileInput: null },
					host,
				);
			},
			{ id: ids[protocol], protocol },
		);
		await page.waitForFunction(
			() => {
				const f = window.desktopFixture;
				return (
					f.state === 'connected' &&
					Array.from(f.host.querySelectorAll('canvas')).some(
						(canvas) =>
							canvas.width >= 800 &&
							canvas.height >= 600 &&
							canvas
								.getContext('2d')
								.getImageData(0, 0, canvas.width, canvas.height)
								.data.some((value, i) => i % 4 !== 3 && value > 0),
					)
				);
			},
			{ timeout: 30000 },
		);
		assert.equal(await page.evaluate(() => window.desktopFixture.connectionId), ids[protocol]);
		services.x('windowfocus', services.x('search', '--name', 'B10-Desktop'));
		await page.evaluate((text) => window.desktopFixture.owner.peer.sendText(text), 'frontend-' + protocol + '\n');
		await waitFor(
			() => services.read('/tmp/typed.txt'),
			(text) => text.includes('frontend-' + protocol),
			protocol + ' actual keyboard',
		);
		await page.evaluate(() => {
			window.desktopFixture.owner.close();
			window.desktopFixture.host.remove();
		});
		await waitFor(
			() => services.connections(),
			(count) => count === 0,
			'actual VNC transport release',
			20000,
		);
		console.log(
			'REAL',
			protocol,
			'HTTP ticket/application milliseconds/browser pixels/remote keyboard/local close PASS',
		);
	}
	await page.evaluate(async (id) => {
		const { createApp, h, nextTick } = await import('/@id/__x00__virtual:desktop-fixture');
		const { default: i18n } = await import('/src/app/i18n/index.ts');
		const { default: Modal } = await import('/src/features/remote-desktop/components/RemoteDesktopModal.vue');
		const { authenticatedSessionLifecycle } = await import('/src/shared/session/public.ts');
		const node = document.createElement('div');
		document.body.append(node);
		const attempts = [];
		const mounted = createApp({
			render: () =>
				h(Modal, {
					visible: true,
					connection: { id, type: 'VNC', name: 'Formal desktop' },

					onConnected: (id) => attempts.push({ id }),
				}),
		});
		mounted.use(i18n).mount(node);
		window.modalFixture = { node, mounted, i18n, nextTick, attempts, authenticatedSessionLifecycle };
	}, ids.VNC);
	await page.waitForFunction(() => document.querySelector('.remote-display-container canvas')?.width >= 800);
	const modal = await page.evaluate(async () => {
		const f = window.modalFixture;
		const checks = [];
		if (f.attempts.length !== 1) throw Error('formal connected event');
		checks.push('formal Modal requests refresh only after connection');
		for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
			f.i18n.global.locale.value = locale;
			await f.nextTick();
			if (document.body.textContent.includes('remoteDesktopModal.')) throw Error('missing desktop translation');
			checks.push('formal Modal locale ' + locale);
		}
		f.authenticatedSessionLifecycle.dispose();
		await f.nextTick();
		if (document.querySelector('.remote-display-container canvas'))
			throw Error('session disposal retained display');
		checks.push('formal Modal session disposal removes original peer');
		f.mounted.unmount();
		f.node.remove();
		return checks;
	});
	await waitFor(
		() => services.connections(),
		(count) => count === 0,
		'formal Modal real close',
		20000,
	);
	assert.deepEqual(errors, []);
	assert.equal(
		await page.evaluate(() => window.desktopBlurListeners.size),
		0,
		'real controller and Modal retire display subscriptions',
	);
	console.log('MODAL', modal.length, modal.join('\n'));
	console.log('Desktop frontend regression PASS; Browser RDP/VNC; native Windows remains remote validation.');
} finally {
	const results = await Promise.allSettled(
		[() => browser?.close(), () => vite?.close(), () => app?.close()].map((close) => Promise.resolve().then(close)),
	);
	const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
	try {
		services?.close();
	} catch (cause) {
		failures.push(cause);
	}
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (cause) {
		failures.push(cause);
	}
	if (failures.length) throw new AggregateError(failures, 'Desktop frontend fixture cleanup failed');
}
