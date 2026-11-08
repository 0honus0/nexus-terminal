import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from '@playwright/test';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import WebSocket from '../../../packages/backend/node_modules/ws/index.js';
import { URL as NodeURL } from 'node:url';
import { onTestFinished } from 'vitest';

/** Real application HTTP and Playwright's cookie jar, without a browser or Vite proxy. */
export async function openFrontendApplication(options = {}) {
	const root = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, 'frontend-application-'));
	const origin = window.location.origin;
	const nativeFetch = globalThis.fetch;
	const application = new Worker(new NodeURL('./frontend-application-worker.mjs', import.meta.url), {
		workerData: {
			directory,
			origin,
			encryptionKey: options.encryptionKey,
			prepareDatabaseModule: options.prepareDatabaseModule,
			configuration: options.configuration,
			trustedProxies: options.trustedProxies,
		},
		execArgv: [],
	});
	const failures = [];
	let exited = false;
	let rejectReady;
	const ready = new Promise((resolve, reject) => {
		rejectReady = reject;
		application.once('message', resolve);
	});
	application.on('error', (cause) => {
		failures.push(cause);
		rejectReady(cause);
	});
	const stopped = new Promise((resolve) =>
		application.once('exit', (code) => {
			exited = true;
			if (code !== 0 && failures.length === 0)
				failures.push(new Error('Frontend backend exited with code ' + code));
			rejectReady(failures[0] ?? new Error('Frontend backend exited before readiness'));
			resolve();
		}),
	);

	const stop = async () => {
		if (!exited) application.postMessage('close');
		await stopped;
		if (failures.length) throw new AggregateError(failures, 'Frontend backend worker failed');
	};

	let context;
	let closing;
	const sockets = new Set();

	const close = () =>
		(closing ??= Promise.resolve().then(async () => {
			const results = await Promise.allSettled([
				...Array.from(sockets, async (socket) => {
					if (socket.readyState === WebSocket.CLOSED) return;
					const closed = once(socket, 'close');
					socket.close();
					await closed;
				}),
				Promise.resolve().then(() => context?.dispose()),
				Promise.resolve().then(stop),
			]);
			const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
			if (failures.length) throw new AggregateError(failures, 'Frontend application fixture cleanup failed');
		}));

	onTestFinished(close);

	try {
		let address = await ready;
		let restarting;
		context = await request.newContext({
			baseURL: 'http://' + address,
			extraHTTPHeaders: { Host: new URL(origin).host, Origin: origin },
		});
		return {
			directory,

			restart() {
				if (closing) return Promise.reject(new Error('Application fixture is closing'));
				if (!restarting) {
					const received = once(application, 'message');
					restarting = Promise.race([
						received,
						stopped.then(() => {
							throw new Error('Application fixture exited during restart');
						}),
					])
						.then(([nextAddress]) => {
							address = nextAddress;
						})
						.finally(() => {
							restarting = undefined;
						});
					application.postMessage('restart');
				}
				return restarting;
			},

			async webSocket() {
				const state = await context.storageState();
				const cookie = state.cookies.map(({ name, value }) => name + '=' + value).join('; ');
				// Snapshot the authenticated context explicitly; this is a real Node WS
				// transport and does not prove browser cookie or Origin enforcement.
				return class ApplicationWebSocket extends WebSocket {
					constructor(path, protocols) {
						const endpoint = new NodeURL(path, origin);
						endpoint.host = address;
						super(endpoint, protocols, {
							headers: { Host: new NodeURL(origin).host, Origin: origin, Cookie: cookie },
						});
						sockets.add(this);
						this.once('close', () => sockets.delete(this));
					}
				};
			},

			async fetch(path, input = {}) {
				const outgoing = new Request(path instanceof Request ? path : new NodeURL(path, origin), input);
				if (outgoing.signal.aborted) throw outgoing.signal.reason;
				const url = new NodeURL(outgoing.url);
				if (url.origin !== origin) return nativeFetch(outgoing);
				const response = await context.fetch('http://' + address + url.pathname + url.search, {
					method: outgoing.method,
					// Preserve the client's bytes, including deliberately malformed JSON.
					// APIRequestContext would otherwise JSON-quote an invalid string.
					data: outgoing.body === null ? undefined : Buffer.from(await outgoing.arrayBuffer()),
					headers: Object.fromEntries(outgoing.headers),
					maxRedirects: 0,
				});
				const bytes = await response.body();
				const bodyless = outgoing.method === 'HEAD' || [204, 205, 304].includes(response.status());
				return new Response(bodyless ? null : bytes, {
					status: response.status(),
					statusText: response.statusText(),
					// The API context owns HttpOnly cookies; browser fetch does not expose Set-Cookie to client code.
					headers: response
						.headersArray()
						.filter((header) => header.name.toLowerCase() !== 'set-cookie')
						.map((header) => [header.name, header.value]),
				});
			},

			close,
		};
	} catch (cause) {
		try {
			await close();
		} catch (cleanup) {
			throw new AggregateError([cause, cleanup], 'Frontend application fixture setup and cleanup failed');
		}
		throw cause;
	}
}
