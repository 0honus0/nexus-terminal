import { waitFor } from './desktop-fixture.mjs';

export function browserDesktopPeer(browser, fixture, origin, response) {
	let context;
	let page;
	let closeResult;
	let resolveClosed;
	let pending = Promise.resolve();
	const closed = new Promise((resolve) => {
		resolveClosed = resolve;
	});
	const events = [];
	const errors = [];

	const finish = (result) => {
		if (closeResult) {
			return;
		}
		closeResult = result;
		resolveClosed(result);
	};

	const opening = (async () => {
		context = await browser.newContext();
		await context.addCookies(
			fixture
				.getSessionCookie()
				.split('; ')
				.map((cookie) => {
					const separator = cookie.indexOf('=');
					return { name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin };
				}),
		);
		page = await context.newPage();
		await page.exposeFunction('desktopReport', (event) => events.push(event));
		await page.exposeFunction('desktopClosed', finish);
		await page.addInitScript(() => {
			const Original = window.WebSocket;
			window.WebSocket = class extends Original {
				constructor(...args) {
					super(...args);
					if (String(args[0]).includes('/ws/remote-desktop')) {
						this.addEventListener(
							'close',
							(event) => void window.desktopClosed({ code: event.code, reason: event.reason }),
						);
					}
				}
			};
		});
		page.on('websocket', (socket) => {
			if (socket.url().includes('/ws/remote-desktop')) {
				socket.on('framesent', ({ payload }) =>
					events.push({ kind: 'sent', binary: typeof payload !== 'string' }),
				);
			}
		});
		await page.goto(origin + '/__desktop-bridge');
		await page.evaluate(async (response) => {
			const { createBrowserDesktop } = await import('/src/features/remote-desktop/adapters/browser-desktop.ts');
			const peer = createBrowserDesktop({
				hasTouch: false,
				touchMode: 'direct',
				mobileInput: null,

				onState(state) {
					if (state !== 'connected') {
						return;
					}
					const canvas = peer.element.querySelector('canvas');
					void window.desktopReport({ kind: 'ready' });
					void window.desktopReport({ kind: 'size', width: canvas?.width, height: canvas?.height });
				},

				onFailure(failure) {
					void window.desktopReport({ kind: 'failure', code: failure.code });
					queueMicrotask(() => peer.close());
				},
			});
			peer.element.style.width = '800px';
			peer.element.style.height = '600px';
			document.body.style.margin = '0';
			document.body.append(peer.element);
			window.desktopPeer = peer;
			peer.connect(response, { width: 800, height: 600, dpi: 96 });
		}, response);
	})();
	void opening.catch((error) => {
		errors.push(error);
		finish({ code: 1006, reason: 'fixture_open_failed' });
	});

	const send = (...args) => {
		pending = pending
			.then(() => opening)
			.then(() =>
				page.evaluate((args) => {
					const [kind, value, y, mask] = args;
					const peer = window.desktopPeer;
					if (kind === 'key' && y === 1) {
						peer.sendText(value === 0xff0d ? '\n' : String.fromCodePoint(value));
					}
					if (kind === 'mouse') {
						const canvas = peer.element.querySelector('canvas');
						const rect = canvas.getBoundingClientRect();
						canvas.dispatchEvent(
							new MouseEvent('mousemove', {
								bubbles: true,
								clientX: rect.left + (value * rect.width) / canvas.width,
								clientY: rect.top + (y * rect.height) / canvas.height,
								buttons: mask,
							}),
						);
					}
				}, args),
			);
		void pending.catch((error) => errors.push(error));
	};

	return {
		events,
		errors,
		closed,
		send,
		sendBinary: send,
		socket: {
			terminate() {
				void opening
					.then(() => context.close())
					.catch((error) => errors.push(error))
					.finally(() => finish({ code: 1006, reason: '' }));
			},
		},

		get closeResult() {
			return closeResult;
		},

		get upgradeStatus() {
			return undefined;
		},

		ready: () =>
			waitFor(
				() => events,
				(values) => values.some((event) => event.kind === 'ready'),
				'real browser desktop ready',
				30000,
			),

		async decodedImage() {
			await opening;
			await page.waitForFunction(
				() =>
					[...window.desktopPeer.element.querySelectorAll('canvas')].some(
						(canvas) =>
							canvas.width > 0 &&
							canvas.height > 0 &&
							canvas
								.getContext('2d')
								.getImageData(0, 0, canvas.width, canvas.height)
								.data.some((value, index) => index % 4 !== 3 && value > 0),
					),
				null,
				{ timeout: 30000 },
			);
		},

		async close() {
			try {
				await opening;
				await pending;
				if (!page.isClosed()) {
					await page.evaluate(() => window.desktopPeer?.close());
				}
			} finally {
				await context?.close();
				finish({ code: 1006, reason: '' });
			}
		},
	};
}
