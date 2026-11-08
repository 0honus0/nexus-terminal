import { expect, test } from '../../support/fixtures';

// A blank same-origin document exercises the real production clients without UI side effects.
test.beforeEach(async ({ page }) => {
	await page.route('**/frontend-diagnostics-fixture', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<html><body><div id="app"></div></body></html>' }),
	);
	await page.goto('/frontend-diagnostics-fixture');
});

test('frontend Pino applies every severity dynamically and redacts diagnostic errors', async ({ page }) => {
	const results = await page.evaluate(async () => {
		const entries: Array<{ channel: string; text: string }> = [];
		for (const channel of ['debug', 'info', 'warn', 'error', 'log'] as const) {
			console[channel] = (...args: unknown[]) => entries.push({ channel, text: JSON.stringify(args) });
		}
		const modulePath = '/__e2e__/browser-diagnostics.js';
		const { logger, setFrontendLogLevel } = await import(modulePath);
		const levels = ['trace', 'debug', 'info', 'warn', 'error', 'silent'];
		const output: Record<string, typeof entries> = {};
		for (const level of levels) {
			setFrontendLogLevel(level, false);
			entries.length = 0;
			for (const method of ['trace', 'debug', 'info', 'warn', 'error'] as const) logger[method](`test-${method}`);
			output[level] = entries.slice();
		}
		entries.length = 0;
		let serializedWhileDisabled = false;
		const privateError = new TypeError('private-password private-chat');
		Object.defineProperty(privateError, 'stack', {
			get() {
				serializedWhileDisabled = true;
				return 'TypeError: private-password\n    at send (https://example.test/client.js?token=private-token:12:34)';
			},
		});
		logger.error({ err: privateError }, 'disabled');
		const disabledSerialized = serializedWhileDisabled;
		setFrontendLogLevel('trace', false);
		logger.error(
			{ err: privateError, password: 'private-password', nested: { token: 'private-token' } },
			'safe-error',
		);
		const safe = entries.slice();
		setFrontendLogLevel('error', false);
		entries.length = 0;
		setFrontendLogLevel('warn');
		setFrontendLogLevel('silent');
		return { output, safe, disabledSerialized, announcements: entries };
	});
	const expected = {
		trace: ['test-trace', 'test-debug', 'test-info', 'test-warn', 'test-error'],
		debug: ['test-debug', 'test-info', 'test-warn', 'test-error'],
		info: ['test-info', 'test-warn', 'test-error'],
		warn: ['test-warn', 'test-error'],
		error: ['test-error'],
		silent: [],
	};
	for (const [level, messages] of Object.entries(expected)) {
		expect(results.output[level].map((entry) => JSON.parse(entry.text)[0].msg)).toEqual(messages);
	}
	expect(results.output.trace.map((entry) => entry.channel)).toEqual(['debug', 'debug', 'info', 'warn', 'error']);
	expect(results.disabledSerialized).toBe(false);
	expect(results.safe).toHaveLength(1);
	expect(JSON.parse(results.safe[0].text)[0]).toMatchObject({
		err: { type: 'TypeError', frames: [{ source: '/client.js', line: 12, column: 34 }] },
		password: '[REDACTED]',
		nested: { token: '[REDACTED]' },
	});
	expect(JSON.stringify(results.safe)).not.toContain('private-');
	expect(results.announcements).toEqual([]);
});

test('frontend HTTP diagnostics correlate results, classify cancellation and omit private payloads', async ({
	page,
}) => {
	await page.route('**/api/v1/__logging_regression?*', (route) => {
		const kind = new URL(route.request().url()).searchParams.get('kind');
		if (kind === 'network') return route.abort('failed');
		if (kind === 'protocol')
			return route.fulfill({ status: 200, contentType: 'application/json', body: 'private-malformed-json' });
		const status = Number(new URL(route.request().url()).searchParams.get('status'));
		return route.fulfill({ status, contentType: 'application/json', body: '{"secret":"private-body"}' });
	});
	const entries = await page.evaluate(async () => {
		const output: string[] = [];
		for (const channel of ['debug', 'info', 'warn', 'error', 'log'] as const) {
			console[channel] = (...args: unknown[]) => output.push(JSON.stringify(args));
		}
		const modulePath = '/__e2e__/browser-diagnostics.js';
		const { httpClient, requestJson, setFrontendLogLevel } = await import(modulePath);
		setFrontendLogLevel('debug', false);
		for (const status of [200, 404, 503]) {
			await httpClient.get(`/__logging_regression?status=${status}&token=private-query`).catch(() => {});
		}
		const controller = new AbortController();
		controller.abort();
		await httpClient.get('/__logging_regression?status=200', { signal: controller.signal }).catch(() => {});
		for (const kind of ['protocol', 'network']) {
			await requestJson({
				method: 'GET',
				url: `/api/v1/__logging_regression?kind=${kind}&token=private-query`,
				maxRequestBytes: 1024,
				maxResponseBytes: 1024,
			}).catch(() => {});
		}
		return output;
	});
	const parsed = entries.map((entry) => JSON.parse(entry)[0]);
	const completed = parsed.filter((entry) => entry.durationMs !== undefined);
	expect(completed.map((entry) => [entry.level, entry.msg, entry.status, entry.code])).toEqual([
		[20, 'HTTP request completed', 200, undefined],
		[20, 'HTTP request rejected', 404, undefined],
		[50, 'HTTP request failed', 503, undefined],
		[20, 'HTTP request cancelled', null, 'cancelled'],
		[50, 'HTTP request failed', 200, 'protocol_failure'],
		[40, 'HTTP request failed', null, 'request_failed'],
	]);
	for (const entry of completed) {
		expect(entry.path).toBe('/api/v1/__logging_regression');
		expect(entry.durationMs).toBeGreaterThanOrEqual(0);
		expect(parsed.filter((item) => item.requestId === entry.requestId)).toHaveLength(2);
	}
	expect(new Set(completed.map((entry) => entry.requestId)).size).toBe(6);
	expect(entries.join('')).not.toContain('private-');
});

test('frontend runtime captures browser, promise and Vue errors without user content', async ({ page }) => {
	const output = await page.evaluate(async () => {
		const entries: string[] = [];
		console.error = (...args: unknown[]) => entries.push(JSON.stringify(args));
		const modulePath = '/__e2e__/browser-diagnostics.js';
		const { registerGlobalRuntimeDiagnostics, registerVueRuntimeDiagnostics, createApp, setFrontendLogLevel } =
			await import(modulePath);
		setFrontendLogLevel('error', false);
		registerGlobalRuntimeDiagnostics();
		registerGlobalRuntimeDiagnostics();
		window.dispatchEvent(
			new ErrorEvent('error', {
				error: new TypeError('private-window'),
				filename: 'https://example.test/runtime.js?token=private-source',
				lineno: 7,
				colno: 9,
			}),
		);
		window.dispatchEvent(
			new PromiseRejectionEvent('unhandledrejection', {
				promise: Promise.resolve(),
				reason: { token: 'private-rejection' },
			}),
		);
		const app = createApp({
			setup() {
				throw new Error('private-vue');
			},

			render() {
				return null;
			},
		});
		registerVueRuntimeDiagnostics(app);
		app.mount('#app');
		app.unmount();
		setFrontendLogLevel('silent', false);
		window.dispatchEvent(new ErrorEvent('error', { error: new Error('private-silent') }));
		return entries;
	});
	const entries = output.map((entry) => JSON.parse(entry)[0]);
	expect(entries.map((entry) => entry.source)).toEqual(['window.error', 'window.unhandledrejection', 'vue']);
	expect(entries.every((entry) => entry.level === 50)).toBe(true);
	expect(entries[0]).toMatchObject({ filename: '/runtime.js', line: 7, column: 9 });
	expect(output.join('')).not.toContain('private-');
});

test('frontend WebSocket diagnostics separate normal and abnormal closure without payloads', async ({ page }) => {
	await page.routeWebSocket('**/ws/__logging_regression?*', (socket) => {
		socket.onMessage((message) =>
			socket.close({
				code: message === 'private-normal' ? 1000 : 1011,
				reason: 'private-close-reason',
			}),
		);
	});
	const output = await page.evaluate(async () => {
		const entries: string[] = [];
		for (const channel of ['debug', 'info', 'warn', 'error', 'log'] as const) {
			console[channel] = (...args: unknown[]) => entries.push(JSON.stringify(args));
		}
		const modulePath = '/__e2e__/browser-diagnostics.js';
		const { openWebSocket, setFrontendLogLevel } = await import(modulePath);
		setFrontendLogLevel('debug', false);
		for (const kind of ['normal', 'abnormal', 'silent']) {
			if (kind === 'silent') setFrontendLogLevel('silent', false);
			await new Promise<void>((resolve, reject) => {
				const socket = openWebSocket(`/ws/__logging_regression?token=private-query&kind=${kind}`);
				socket.addEventListener('open', () => socket.send(`private-${kind}`), { once: true });
				socket.addEventListener('close', () => resolve(), { once: true });
				socket.addEventListener('error', () => reject(new Error('Diagnostic fixture failed')), { once: true });
			});
		}
		return entries;
	});
	const entries = output.map((entry) => JSON.parse(entry)[0]);
	expect(entries.map((entry) => entry.level)).toEqual([20, 30, 20, 20, 30, 40]);
	const closed = entries.filter((entry) => entry.msg === 'WebSocket transport closed');
	expect(closed.map((entry) => entry.code)).toEqual([1000, 1011]);
	for (const entry of closed) {
		expect(entry.path).toBe('/ws/__logging_regression');
		expect(entry.durationMs).toBeGreaterThanOrEqual(0);
		expect(entries.filter((item) => item.transportId === entry.transportId)).toHaveLength(3);
	}
	expect(output.join('')).not.toContain('private-');
});
