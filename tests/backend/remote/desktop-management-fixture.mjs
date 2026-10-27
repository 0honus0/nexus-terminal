import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import { createServer as createViteServer } from '../../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { openManagement } from '../http/management-fixture.mjs';
import { expectStatus } from './openssh-fixture.mjs';
import { openDesktopServices, desktopPeer, waitFor } from './desktop-fixture.mjs';
import { browserDesktopPeer } from './desktop-browser-peer.mjs';

const { chromium } = createRequire(new URL('../../e2e/package.json', import.meta.url))('@playwright/test');

export async function openDesktopManagement(t, label) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-desktop-'));
	let services;
	let f;
	let browser;
	let vite;
	const issued = new Map();
	const peers = new Set();
	const warnings = [];

	const onWarning = (warning) => {
		if (warning.name === 'MaxListenersExceededWarning') {
			warnings.push(warning.message);
		}
	};

	process.on('warning', onWarning);
	t.afterEach(async () => {
		const outcomes = await Promise.allSettled([...peers].map((peer) => peer.close()));
		peers.clear();
		const failures = outcomes.flatMap((value) => (value.status === 'rejected' ? [value.reason] : []));
		if (failures.length) {
			throw new AggregateError(failures, 'Desktop scenario cleanup failed');
		}
	});
	t.after(async () => {
		process.off('warning', onWarning);
		const failures = [];
		const outcomes = await Promise.allSettled([...peers].map((peer) => peer.close()));
		failures.push(...outcomes.flatMap((value) => (value.status === 'rejected' ? [value.reason] : [])));
		const owners = [
			() => f?.close(),
			() => browser?.close(),
			() => vite?.close(),
			() => services && writeFile('/tmp/nexus-b10-batch11-desktop-' + label + '-services.log', services.logs()),
		];
		const closed = await Promise.allSettled(owners.map((close) => Promise.resolve().then(close)));
		failures.push(...closed.flatMap((value) => (value.status === 'rejected' ? [value.reason] : [])));
		try {
			services?.close();
		} catch (error) {
			failures.push(error);
		}
		try {
			await rm(directory, { recursive: true, force: true });
		} catch (error) {
			failures.push(error);
		}
		if (failures.length) {
			throw new AggregateError(failures, 'Desktop fixture shutdown failed');
		}
	});
	services = await openDesktopServices();

	const allocatePort = async () => {
		const server = createNetServer();
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = server.address().port;
		await new Promise((resolve) => server.close(resolve));
		return port;
	};

	const frontendPort = await allocatePort();
	const backendPort = await allocatePort();
	const origin = 'http://127.0.0.1:' + frontendPort;
	f = await openManagement(directory, {}, { origin, port: backendPort });
	vite = await createViteServer({
		root: fileURLToPath(new URL('../../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: {
			host: '127.0.0.1',
			port: frontendPort,
			strictPort: true,
			proxy: {
				'/api': { target: 'http://127.0.0.1:' + backendPort, changeOrigin: false },
				'/ws/remote-desktop': { target: 'ws://127.0.0.1:' + backendPort, changeOrigin: false, ws: true },
			},
		},
		plugins: [
			{
				name: 'desktop-bridge-fixture',

				configureServer(server) {
					server.middlewares.use('/__desktop-bridge', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Desktop bridge fixture</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const base = '/api/v1/targets/connections';

	const create = async (type, port, password = 'b10-pass') => {
		const connection = expectStatus(
			await f.api('POST', base, {
				name: 'B10 ' + type,
				type,
				host: services.host,
				port: port === 3389 ? services.rdpPort : services.vncPort,
				username: 'test',
				route: 'direct',
				proxyId: null,
				notes: null,
				tagIds: [],
				jumpIds: [],
			}),
			201,
		);
		if (password !== null) {
			expectStatus(
				await f.api('PUT', base + '/' + connection.id + '/credential', {
					version: connection.version,
					credential: { kind: 'password', password },
				}),
				200,
			);
		}
		return connection.id;
	};

	const vnc = await create('VNC', 5900);
	const rdp = await create('RDP', 3389);

	const path = (id, type) => '/api/v1/connections/' + id + '/' + type + '-session';

	const get = async (id) => expectStatus(await f.api('GET', base + '/' + id), 200);

	const recent = (id) => {
		const database = new DatabaseSync(f.database, { readOnly: true });
		try {
			return database.prepare('SELECT last_connected_at FROM connections WHERE id=?').get(id).last_connected_at;
		} finally {
			database.close();
		}
	};

	const change = async (id, changes) =>
		expectStatus(await f.api('PUT', base + '/' + id, { version: (await get(id)).version, changes }), 200);

	const issue = async (id, type, query = '') => {
		const result = expectStatus(await f.api('POST', path(id, type) + query), 200);
		assert.deepEqual(Object.keys(result), ['ticket', 'protocol', 'host', 'port', 'username', 'password']);
		issued.set(result.ticket, result);
		assert.match(result.ticket, /^[A-Za-z0-9_-]{43}$/u);
		return result.ticket;
	};

	const peerFor = (ticket, headers) => {
		const response = issued.get(ticket);
		const peer =
			!response || (headers && Object.keys(headers).length > 0)
				? desktopPeer(f, ticket, headers)
				: browserDesktopPeer(browser, f, origin, response);
		peers.add(peer);
		return peer;
	};

	const connect = async (id, type) => {
		const peer = peerFor(await issue(id, type));
		await peer.ready();
		return peer;
	};

	const settled = async () =>
		waitFor(
			() => services.connections(),
			(value) => value === 0,
			'all original VNC TCP connections released',
			20000,
		);

	const refused = async (ticket, headers, code = 1008) => {
		const peer = peerFor(ticket, headers);
		const result = await peer.closed;
		assert.equal(result.code, code);
		assert.equal(
			peer.events.some((event) => event.kind === 'ready'),
			false,
		);
		return peer;
	};

	const decodedImage = (peer) => peer.decodedImage();

	return {
		f,
		services,
		base,
		create,
		vnc,
		rdp,
		path,
		get,
		recent,
		change,
		issue,
		peerFor,
		connect,
		settled,
		refused,
		decodedImage,
		warnings,
	};
}
