import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { openHttpListener } from '../../../../../packages/backend/dist/platform/http/http-server.js';
import { createRemoteHttpRoutes } from '../../../../../packages/backend/dist/modules/remote/interfaces/http/remote-http.js';
import { createRemoteFileHttpRoutes } from '../../../../../packages/backend/dist/modules/remote/interfaces/http/file-http.js';
import { createDesktopHttpRoutes } from '../../../../../packages/backend/dist/modules/remote/interfaces/http/desktop-http.js';
import { createBackgroundRoutes } from '../../../../../packages/backend/dist/modules/preferences/interfaces/http/background-http.js';
import { AppearanceFailure } from '../../../../../packages/backend/dist/modules/preferences/appearance-failure.js';
import { createSuspendHttpRoutes } from '../../../../../packages/backend/dist/modules/remote/interfaces/http/suspend-http.js';
import { createPluginIntentHttpRoutes } from '../../../../../packages/backend/dist/modules/agent/interfaces/http/plugin-intent-http.js';
import { createArtifactHttpRoutes } from '../../../../../packages/backend/dist/modules/agent/interfaces/http/artifact-http.js';
import { sendHtmlThemeText } from '../../../../../packages/backend/dist/modules/preferences/interfaces/http/html-theme-http-support.js';
import { createFileDownloadHttpRoutes } from '../../../../../packages/backend/dist/modules/remote/interfaces/http/file-download-http.js';
import { FileRangeNotSatisfiable } from '../../../../../packages/backend/dist/modules/remote/files/model/file-types.js';

const origin = 'http://127.0.0.1:0';
const resourceId = '019c0539-1b73-7000-8000-000000000001';

function get(server, path, onChunk = () => {}) {
	return new Promise((resolve, reject) => {
		const req = request(
			'http://' + server.address + path,
			{
				headers: { Host: new URL(origin).host, Cookie: 'nexus_session=token' },
			},
			(response) => {
				const chunks = [];
				response.on('data', (chunk) => {
					chunks.push(chunk);
					onChunk(chunk, response, req);
				});
				response.on('error', reject);
				response.on('end', () =>
					resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }),
				);
			},
		);
		req.on('error', reject);
		req.setTimeout(5000, () => req.destroy(new Error('Stream delivery deadline')));
		req.end();
	});
}

function post(server, path, body) {
	return new Promise((resolve, reject) => {
		const req = request(
			'http://' + server.address + path,
			{
				method: 'POST',
				headers: { Host: new URL(origin).host, Origin: origin, 'Content-Type': 'application/json' },
			},
			(response) => {
				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('error', reject);
				response.on('end', () =>
					resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }),
				);
			},
		);
		req.on('error', reject);
		req.setTimeout(5000, () => req.destroy(new Error('Resource delivery deadline')));
		req.end(JSON.stringify(body));
	});
}

const cases = [
	{
		name: 'shell session',
		path: '/api/v1/remote/sessions',
		body: { targetId: 1, columns: 80, rows: 24 },
		status: 201,

		routes(release) {
			return createRemoteHttpRoutes({
				async open() {
					return { id: resourceId, targetId: 1, fingerprint: 'fingerprint', startedAt: 1 };
				},

				async release(id) {
					assert.equal(id, resourceId);
					release();
				},
			});
		},
	},
	{
		name: 'file resource',
		path: '/api/v1/remote/files/resources',
		body: { targetId: 1 },
		status: 201,

		routes(release) {
			return createRemoteFileHttpRoutes({
				async open() {
					return {
						id: resourceId,
						targetId: 1,
						fingerprint: 'fingerprint',

						async release() {
							release();
						},
					};
				},
			});
		},
	},
	{
		name: 'desktop ticket',
		path: '/api/v1/connections/1/rdp-session',
		body: { certificate: null },
		status: 200,

		routes(release) {
			return createDesktopHttpRoutes({
				async issue() {
					return {
						ticket: 't'.repeat(43),
						connection: {
							protocol: 'RDP',
							host: 'localhost',
							port: 3389,
							username: 'user',
							password: 'secret',
						},
					};
				},

				discard(ticket) {
					assert.equal(ticket, 't'.repeat(43));
					release();
				},
			});
		},
	},
];

for (const scenario of cases) {
	for (const failDelivery of [false, true]) {
		test(
			`${scenario.name} ${failDelivery ? 'releases its resource after asynchronous onSend failure' : 'retains its resource after successful delivery'}`,
			{ timeout: 10000 },
			async () => {
				let released = 0;
				const server = await openHttpListener({
					bindHost: '127.0.0.1',
					port: 0,
					publicOrigin: origin,
					trustedProxies: [],
					routes: scenario
						.routes(() => {
							released++;
						})
						.map((route) => ({
							...route,

							async onSend(_request, reply, payload) {
								await nextTurn();
								if (failDelivery && reply.statusCode < 300)
									throw new Error('Injected delivery hook failure');
								return payload;
							},
						})),
				});
				try {
					const response = await post(server, scenario.path, scenario.body);
					assert.equal(response.status, failDelivery ? 500 : scenario.status);
					if (failDelivery) assert.deepEqual(response.body, { code: 'internal_failure' });
					const suspension = server.suspend();
					await suspension.drain();
					assert.equal(released, failDelivery ? 1 : 0);
				} finally {
					await server.close();
				}
			},
		);
	}
}

for (const mode of ['before-first-chunk', 'after-first-chunk', 'success', 'empty']) {
	test(`background stream ${mode} preserves response and owner cleanup`, { timeout: 10000 }, async () => {
		let cleaned = 0;
		const sizeBytes = mode === 'empty' ? 0 : 2;
		const server = await openHttpListener({
			bindHost: '127.0.0.1',
			port: 0,
			publicOrigin: origin,
			trustedProxies: [],
			routes: createBackgroundRoutes(
				{
					async read(_actor, _id, signal, deliver) {
						try {
							await deliver(
								{
									mediaType: 'image/png',
									sizeBytes,

									async transfer(write) {
										await write(new Uint8Array());
										if (mode === 'before-first-chunk')
											throw new AppearanceFailure('storage_unavailable');
										if (mode !== 'empty') await write(Uint8Array.of(1));
										if (mode === 'after-first-chunk')
											throw new AppearanceFailure('storage_unavailable');
										if (mode === 'success') await write(Uint8Array.of(2));
									},
								},
								signal,
							);
						} finally {
							cleaned++;
						}
					},
				},
				{
					async authenticate() {
						return { userId: 1 };
					},
				},
			),
		});
		try {
			if (mode === 'after-first-chunk') {
				await assert.rejects(
					get(server, '/api/v1/appearance/background/file/019c0539-1b73-4000-8000-000000000001'),
					(error) => error.code === 'ECONNRESET',
				);
			} else {
				const response = await get(
					server,
					'/api/v1/appearance/background/file/019c0539-1b73-4000-8000-000000000001',
				);
				assert.equal(response.status, mode === 'before-first-chunk' ? 503 : 200);
				if (mode === 'before-first-chunk') {
					assert.match(response.headers['content-type'], /^application\/json/u);
					assert.deepEqual(JSON.parse(response.bytes.toString()), { code: 'storage_unavailable' });
				} else {
					assert.equal(response.headers['content-type'], 'image/png');
					assert.equal(response.headers['content-length'], String(sizeBytes));
					assert.deepEqual(response.bytes, mode === 'empty' ? Buffer.alloc(0) : Buffer.from([1, 2]));
				}
			}
			const suspension = server.suspend();
			await suspension.drain();
			assert.equal(cleaned, 1);
		} finally {
			await server.close();
		}
	});
}

for (const abort of [false, true]) {
	test(
		`native suspended log ${abort ? 'cancellation closes its source' : 'waits for source and transport completion'}`,
		{ timeout: 10000 },
		async () => {
			const release = Promise.withResolvers();
			const began = Promise.withResolvers();
			let cleaned = 0;
			let delivered = false;
			const server = await openHttpListener({
				bindHost: '127.0.0.1',
				port: 0,
				publicOrigin: origin,
				trustedProxies: [],
				routes: createSuspendHttpRoutes({
					async deliverSuspendedLog(_token, _id, delivery, signal) {
						const bytes = (async function* () {
							try {
								yield Buffer.from('log');
								began.resolve();
								if (abort) {
									await new Promise((resolve) =>
										signal.addEventListener('abort', resolve, { once: true }),
									);
									signal.throwIfAborted();
								} else {
									await release.promise;
								}
							} finally {
								cleaned++;
							}
						})();
						await delivery.deliver('suspended.txt', bytes, signal);
						delivered = true;
						return true;
					},
				}).map((route) => ({
					...route,

					async onSend(_request, reply, payload) {
						await nextTurn();
						reply.header('X-Native-Hook', 'log');
						return payload;
					},
				})),
			});
			try {
				const pending = get(server, '/api/v1/ssh-suspend/log/session_1', (_chunk, _response, req) => {
					if (abort) req.destroy();
				});
				void pending.catch(() => undefined);
				await began.promise;
				assert.equal(delivered, false);
				release.resolve();
				if (abort) {
					await assert.rejects(pending, (error) => error.code === 'ECONNRESET');
				} else {
					const response = await pending;
					assert.equal(response.status, 200);
					assert.equal(response.headers['x-native-hook'], 'log');
					assert.equal(response.headers['cache-control'], 'private, no-store');
					assert.equal(response.headers['x-content-type-options'], 'nosniff');
					assert.equal(response.bytes.toString(), 'log');
				}
				await server.suspend().drain();
				assert.equal(cleaned, 1);
				assert.equal(delivered, !abort);
			} finally {
				release.resolve();
				await server.close();
			}
		},
	);
}

for (const kind of ['intent', 'artifact']) {
	for (const failAuthorization of [false, true]) {
		test(
			`native ${kind} content ${failAuthorization ? 'withholds its final byte on authorization failure' : 'runs hooks and completes after final authorization'}`,
			{ timeout: 10000 },
			async () => {
				const release = Promise.withResolvers();
				const firstByte = Promise.withResolvers();
				let cleaned = 0;
				let received = 0;
				const server = await openHttpListener({
					bindHost: '127.0.0.1',
					port: 0,
					publicOrigin: origin,
					trustedProxies: [],
					routes: (kind === 'intent' ? createPluginIntentHttpRoutes : createArtifactHttpRoutes)(
						{
							async authenticate() {
								return { userId: 1 };
							},
						},
						{
							async artifact() {
								return { sizeBytes: 2, name: 'binary.dat', version: 1 };
							},

							async get() {
								return {
									sizeBytes: 2,
									name: 'binary.dat',
									version: 1,
									status: 'ready',
									retained: true,
								};
							},

							async *read() {
								try {
									yield Uint8Array.of(1, 2);
									await release.promise;
									if (failAuthorization) throw new Error('private final authorization failure');
								} finally {
									cleaned++;
								}
							},
						},
						(work) => work(),
					).map((route) => ({
						...route,

						async onSend(_request, reply, payload) {
							await nextTurn();
							reply.header('X-Native-Hook', 'intent');
							return payload;
						},
					})),
				});
				try {
					const pending = get(
						server,
						kind === 'intent'
							? `/api/v1/agent/apps/${resourceId}/plugin-intents/${resourceId}/artifacts/${resourceId}/content`
							: `/api/v1/agent/apps/${resourceId}/artifacts/${resourceId}/content`,
						(chunk) => {
							received += chunk.length;
							firstByte.resolve();
						},
					);
					void pending.catch(() => undefined);
					await firstByte.promise;
					assert.equal(received, 1);
					assert.equal(cleaned, 0);
					release.resolve();
					if (failAuthorization) {
						await assert.rejects(pending, (error) => error.code === 'ECONNRESET');
						assert.equal(received, 1);
					} else {
						const response = await pending;
						assert.equal(response.status, 200);
						assert.equal(response.headers['x-native-hook'], 'intent');
						assert.match(response.headers['cache-control'], /no-store/u);
						assert.equal(response.headers['x-content-type-options'], 'nosniff');
						assert.deepEqual(response.bytes, Buffer.from([1, 2]));
					}
					await server.suspend().drain();
					assert.equal(cleaned, 1);
				} finally {
					release.resolve();
					await server.close();
				}
			},
		);
	}
}

test('native plugin intent source failure before its first byte delivers safe JSON', { timeout: 10000 }, async () => {
	let cleaned = 0;
	const server = await openHttpListener({
		bindHost: '127.0.0.1',
		port: 0,
		publicOrigin: origin,
		trustedProxies: [],
		routes: createPluginIntentHttpRoutes(
			{
				async authenticate() {
					return { userId: 1 };
				},
			},
			{
				async artifact() {
					return { sizeBytes: 2, name: 'binary.dat', version: 1 };
				},

				async *read() {
					try {
						throw new Error('private source storage error');
					} finally {
						cleaned++;
					}
				},
			},
			(work) => work(),
		),
	});
	try {
		const response = await get(
			server,
			`/api/v1/agent/apps/${resourceId}/plugin-intents/${resourceId}/artifacts/${resourceId}/content`,
		);
		assert.equal(response.status, 500);
		assert.match(response.headers['content-type'], /^application\/json/u);
		assert.deepEqual(JSON.parse(response.bytes.toString()), { code: 'internal_failure' });
		if (response.headers['content-length'] !== undefined) {
			assert.equal(response.headers['content-length'], String(response.bytes.length));
		}
		assert.equal(response.headers['content-disposition'], undefined);
		await server.suspend().drain();
		assert.equal(cleaned, 1);
	} finally {
		await server.close();
	}
});

for (const failHook of [false, true]) {
	test(
		`native HTML theme text ${failHook ? 'rejects a failed hook delivery' : 'runs hooks and confirms transport delivery'}`,
		{ timeout: 10000 },
		async () => {
			let delivered = false;
			let cleaned = 0;
			const server = await openHttpListener({
				bindHost: '127.0.0.1',
				port: 0,
				publicOrigin: origin,
				trustedProxies: [],
				routes: [
					{
						method: 'GET',
						url: '/theme-text',

						async onSend(_request, reply, payload) {
							await nextTurn();
							if (failHook) throw new Error('private hook failure');
							reply.header('X-Native-Hook', 'theme');
							return payload;
						},

						async handler(req, reply) {
							try {
								await sendHtmlThemeText(req, reply, '主题正文', new AbortController().signal);
								delivered = true;
							} finally {
								cleaned++;
							}
						},
					},
				],
			});
			try {
				const response = await get(server, '/theme-text');
				assert.equal(response.status, failHook ? 500 : 200);
				if (failHook) {
					assert.deepEqual(JSON.parse(response.bytes.toString()), { code: 'internal_failure' });
				} else {
					assert.equal(response.headers['x-native-hook'], 'theme');
					assert.equal(response.headers['cache-control'], 'private, no-store');
					assert.equal(response.headers['x-content-type-options'], 'nosniff');
					assert.equal(response.bytes.toString(), '主题正文');
				}
				await server.suspend().drain();
				assert.equal(delivered, !failHook);
				assert.equal(cleaned, 1);
			} finally {
				await server.close();
			}
		},
	);
}

test('native unsatisfiable file range runs hooks and preserves security headers', { timeout: 10000 }, async () => {
	const server = await openHttpListener({
		bindHost: '127.0.0.1',
		port: 0,
		publicOrigin: origin,
		trustedProxies: [],
		routes: createFileDownloadHttpRoutes({
			async inspectDownloadKind() {
				return 'file';
			},

			async downloadWorkspace() {
				throw new FileRangeNotSatisfiable(3);
			},
		}).map((route) => ({
			...route,

			async onSend(_request, reply, payload) {
				await nextTurn();
				reply.header('X-Native-Hook', 'range');
				return payload;
			},
		})),
	});
	try {
		const response = await get(server, '/api/v1/sftp/download?connectionId=1&remotePath=/file');
		assert.equal(response.status, 416);
		assert.equal(response.headers['x-native-hook'], 'range');
		assert.equal(response.headers['cache-control'], 'private, no-store');
		assert.equal(response.headers['x-content-type-options'], 'nosniff');
		assert.equal(response.headers['content-range'], 'bytes */3');
		assert.equal(response.bytes.length, 0);
	} finally {
		await server.close();
	}
});
