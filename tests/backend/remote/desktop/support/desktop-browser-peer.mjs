import { waitFor } from './desktop-fixture.mjs';

export function browserDesktopPeer(browser, fixture, origin, response, services) {
	let context;
	let page;
	let closeResult;
	let resolveClosed;
	let pending = Promise.resolve();
	let closing;
	let terminating;
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
		context = await (await browser).newContext();
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

		const diagnostic = (message) =>
			message.replaceAll(response.ticket, '[ticket]').replaceAll(response.password, '[password]');

		page.on('pageerror', (cause) => errors.push(new Error(diagnostic(cause.message))));
		page.on('console', (message) => {
			if (message.type() === 'error') errors.push(new Error(diagnostic(message.text())));
		});
		await page.exposeFunction('desktopReport', (event) => events.push(event));
		await page.exposeFunction('desktopClosed', finish);
		await page.addInitScript(() => {
			const Original = window.WebSocket;
			window.WebSocket = new Proxy(Original, {
				construct(Target, args) {
					// Preserve the native prototype: noVNC validates its immediate channel properties.
					const socket = new Target(...args);
					if (String(args[0]).includes('/ws/remote-desktop')) {
						socket.addEventListener(
							'close',
							(event) => void window.desktopClosed({ code: event.code, reason: event.reason }),
						);
					}
					return socket;
				},
			});
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
		if (response.protocol === 'RDP') {
			await waitFor(
				() => {
					if (events.some((event) => event.kind === 'failure'))
						throw new AggregateError(
							errors,
							'Actual desktop SDK failed: ' + errors.map((cause) => cause.message).join('; '),
						);
					return events;
				},
				(values) => values.some((event) => event.kind === 'ready'),
				'Actual RDP SDK connection',
				30000,
			);
			const before = await services.authenticatedSessions();
			await page.waitForFunction(() => {
				const canvas = window.desktopPeer.element.querySelector('canvas');
				const context = canvas?.getContext('2d');
				return (
					canvas &&
					context?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3]
				);
			});
			const input = page.locator('textarea');
			await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter' });
			await input.dispatchEvent('keyup', { key: 'Enter', code: 'Enter' });
			await waitFor(
				() => services.authenticatedSessions(),
				(count) => count === before + 1,
				'Real xrdp VNC login',
			);
		}
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
				terminating ??= opening.then(async () => {
					await context.close();
					// A destroyed page cannot report its WebSocket close event back to Node.
					finish({ code: 1006, reason: 'fixture_context_terminated' });
				});
				void terminating.catch((error) => errors.push(error));
			},
		},

		get closeResult() {
			return closeResult;
		},

		get upgradeStatus() {
			return undefined;
		},

		ready: async () => {
			await opening;
			return waitFor(
				() => {
					if (events.some((event) => event.kind === 'failure'))
						throw new AggregateError(
							errors,
							'Actual desktop SDK failed: ' + errors.map((cause) => cause.message).join('; '),
						);
					return events;
				},
				(values) => values.some((event) => event.kind === 'ready'),
				'real browser desktop ready',
				30000,
			);
		},

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

		close() {
			closing ??= Promise.resolve().then(async () => {
				try {
					await opening;
					await pending;
					if (terminating) await terminating;
					else if (!page.isClosed()) await page.evaluate(() => window.desktopPeer?.close());
				} finally {
					await context?.close();
					finish({ code: 1006, reason: 'fixture_context_closed' });
				}
			});
			return closing;
		},
	};
}
