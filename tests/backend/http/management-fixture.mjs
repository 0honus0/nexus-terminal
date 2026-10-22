import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { request } from 'node:http';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { send, expectStatus } from '../remote/openssh-fixture.mjs';
import WebSocket from '../../../packages/backend/node_modules/ws/index.js';

const origin = 'http://127.0.0.1:0';
const password = 'isolated-management-b10-password-123';

/** Only the installed HTTP listener is used to change application state. */
export async function openManagement(directory, options = {}, transport = { origin, port: 0 }) {
	const origin = transport.origin;
	const database = join(directory, 'management.db');
	const encryptionKey = randomBytes(32);
	let app;
	let address;
	let cookie = '';

	async function open() {
		app = await createApp(database, { encryptionKey, ...options });
		address = await app.listenHttp({
			publicOrigin: origin,
			bindHost: '127.0.0.1',
			port: transport.port,
			trustedProxies: [],
		});
	}

	const wireHeaders = (headers) => ({ Host: new URL(origin).host, Origin: origin, ...headers });

	const api = (method, path, input, headers) => send(address, cookie, method, path, input, wireHeaders(headers));

	async function login() {
		const result = await api('POST', '/api/v1/auth/login', { username: 'admin', password, rememberMe: false });
		expectStatus(result, 200);
		cookie = result.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
	}

	try {
		await open();
		expectStatus(
			await api('POST', '/api/v1/auth/setup', { username: 'admin', password, confirmPassword: password }),
			201,
		);
		await login();
	} catch (error) {
		if (app) {
			try {
				await app.close();
			} catch (cleanup) {
				throw new AggregateError([error, cleanup], 'Management fixture setup and shutdown failed');
			}
		}
		throw error;
	}
	return {
		api,

		getSessionCookie: () => cookie,

		database,
		password,
		login,

		/** Pause real response consumption so tests can observe an open server-side blob handle. */
		stream(path) {
			return new Promise((resolve, reject) => {
				const req = request(
					'http://' + address + path,
					{ headers: { Host: new URL(origin).host, Origin: origin, Cookie: cookie } },
					(response) => {
						response.pause();
						const chunks = [];
						let failure;
						const finished = new Promise((settle) => {
							response.on('data', (chunk) => chunks.push(chunk));
							response.on('error', (error) => {
								failure = error;
							});
							response.once('close', () =>
								settle({
									complete: response.complete,
									bytes: Buffer.concat(chunks),
									error: failure,
								}),
							);
						});
						resolve({
							status: response.statusCode,
							headers: response.headers,
							finished,

							resume: () => response.resume(),

							cancel: () => {
								response.destroy();
								req.destroy();
							},
						});
					},
				);
				req.on('error', reject);
				req.setTimeout(15000, () => req.destroy(new Error('Management stream deadline')));
				req.end();
			});
		},

		socket(path, headers = {}) {
			return new WebSocket('ws://' + address + path, {
				origin: headers.Origin ?? origin,
				headers: { Host: new URL(origin).host, Cookie: cookie, ...headers },
			});
		},

		anonymous: (method, path, input, headers) => send(address, '', method, path, input, wireHeaders(headers)),

		async restart(verifyShutdown = (close) => close()) {
			await verifyShutdown(() => app.close());
			app = undefined;
			await open();
		},

		async close() {
			await app?.close();
		},
	};
}
