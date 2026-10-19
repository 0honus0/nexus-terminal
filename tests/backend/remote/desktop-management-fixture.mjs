import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { openManagement } from '../http/management-fixture.mjs';
import { expectStatus } from './openssh-fixture.mjs';
import { openDesktopServices, desktopPeer, waitFor } from './desktop-fixture.mjs';

const { chromium } = createRequire(new URL('../../e2e/package.json', import.meta.url))('@playwright/test');

export async function openDesktopManagement(t, label) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-desktop-'));
	let services;
	let f;
	let browser;
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
	f = await openManagement(directory, { guacd: { host: '127.0.0.1', port: services.port } });
	const base = '/api/v1/targets/connections';

	const create = async (type, port, password = 'b10-pass') => {
		const connection = expectStatus(
			await f.api('POST', base, {
				name: 'B10 ' + type,
				type,
				host: 'desktop',
				port,
				username: 'test',
				route: 'direct',
				proxyId: null,
				notes: null,
				rdpRemoteApp: null,
				rdpRemoteAppDirectory: null,
				rdpRemoteAppArguments: null,
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
		assert.deepEqual(Object.keys(result).sort(), ['lastConnectedAt', 'ticket']);
		assert.match(result.ticket, /^[A-Za-z0-9_-]{43}$/u);
		assert.ok(Number.isSafeInteger(result.lastConnectedAt));
		return result.ticket;
	};

	const peerFor = (ticket, headers) => {
		const peer = desktopPeer(f, ticket, headers);
		peers.add(peer);
		return peer;
	};

	const connect = async (id, type) => {
		const peer = peerFor(await issue(id, type));
		await peer.ready();
		return peer;
	};

	// guacd detects abruptly lost clients within its own 15-second timeout.
	// Upstream release is observed separately from local WS/TCP shutdown.
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
			peer.instructions.some((item) => item[0] === ''),
			false,
		);
		return peer;
	};

	const decodedImage = async (peer) => {
		browser ??= await chromium.launch({ headless: true, args: ['--no-sandbox'] });
		const image = await waitFor(
			() => {
				const streams = new Map();
				for (const item of peer.instructions) {
					if (item[0] === 'img' && item[3] === '0') {
						streams.set(item[1], { mime: item[4], chunks: [] });
					}
					if (item[0] === 'blob') {
						streams.get(item[1])?.chunks.push(Buffer.from(item[2], 'base64'));
					}
					if (item[0] === 'end' && streams.has(item[1])) {
						const value = streams.get(item[1]);
						return { mime: value.mime, bytes: Buffer.concat(value.chunks) };
					}
				}
				return null;
			},
			(value) => value !== null,
			'actual complete desktop image stream',
		);
		assert.match(image.mime, /^image\/(png|jpeg)$/u);
		const page = await browser.newPage();
		try {
			const size = await page.evaluate(
				async (url) => {
					const img = new Image();
					img.src = url;
					await img.decode();
					return { width: img.naturalWidth, height: img.naturalHeight };
				},
				'data:' + image.mime + ';base64,' + image.bytes.toString('base64'),
			);
			assert.ok(size.width > 0 && size.height > 0);
		} finally {
			await page.close();
		}
	};

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
