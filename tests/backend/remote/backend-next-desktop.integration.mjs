import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDesktopManagement } from './desktop-management-fixture.mjs';
import { expectStatus } from './openssh-fixture.mjs';
import { waitFor } from './desktop-fixture.mjs';

await test('B10 real VNC/RDP display, input, admission and transport faults', { timeout: 60000 }, async (t) => {
	const {
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
	} = await openDesktopManagement(t, 'connections');
	await t.test('anonymous, mismatched protocol and nonexistent targets fail before bridge', async () => {
		expectStatus(await f.anonymous('POST', path(vnc, 'vnc')), 401);
		expectStatus(await f.api('POST', path(vnc, 'rdp')), 400);
		expectStatus(await f.api('POST', path(999999, 'vnc')), 404);
		assert.equal(services.connections(), 0);
	});
	await t.test('display boundaries, duplicate query and request body refuse without marking attempt', async () => {
		const before = await get(vnc);
		for (const query of [
			'?width=199',
			'?height=8193',
			'?dpi=47',
			'?dpi=481',
			'?width=800&width=900',
			'?extra=1',
			'?width=2e3',
		]) {
			expectStatus(await f.api('POST', path(vnc, 'vnc') + query), 400);
		}
		expectStatus(await f.api('POST', path(vnc, 'vnc'), {}), 400);
		assert.deepEqual(await get(vnc), before);
	});
	await t.test('missing password does not record a successful connection', async () => {
		const id = await create('VNC', 5900, null);
		const before = await get(id);
		expectStatus(await f.api('POST', path(id, 'vnc')), 400);
		const after = await get(id);
		assert.equal(after.version, before.version);
		assert.equal(recent(id), null);
		assert.equal(services.connections(), 0);
	});
	await t.test('VNC reaches real desktop pixels and forwards keyboard/mouse to X server', async () => {
		const peer = await connect(vnc, 'vnc');
		await decodedImage(peer);
		assert.ok(peer.events.some((item) => item.kind === 'size' && item.width === 800 && item.height === 600));
		peer.send('mouse', 120, 90, 0);
		await waitFor(
			() => services.x('getmouselocation', '--shell'),
			(value) => value.includes('X=120\nY=90'),
			'VNC pointer actual server coordinates',
		);
		services.x('windowfocus', services.x('search', '--name', 'B10-Desktop'));
		for (const char of 'vnc-actual\n') {
			const key = char === '\n' ? 0xff0d : char.codePointAt(0);
			peer.send('key', key, 1);
			peer.send('key', key, 0);
		}
		await waitFor(
			() => services.read('/tmp/typed.txt'),
			(value) => value.includes('vnc-actual'),
			'VNC key delivered to real xterm',
		);
		await peer.close();
		await settled();
	});
	await t.test('RDP reaches real xrdp display and forwards keyboard/mouse', async () => {
		const peer = peerFor(await issue(rdp, 'rdp', '?width=800&height=600&dpi=120'));
		await peer.ready();
		await decodedImage(peer);
		peer.send('mouse', 150, 110, 0);
		await waitFor(
			() => services.x('getmouselocation', '--shell'),
			(value) => value.includes('X=150\nY=110'),
			'RDP pointer actual server coordinates',
		);
		services.x('windowfocus', services.x('search', '--name', 'B10-Desktop'));
		for (const char of 'rdp-actual\n') {
			const key = char === '\n' ? 0xff0d : char.codePointAt(0);
			peer.send('key', key, 1);
			peer.send('key', key, 0);
		}
		await waitFor(
			() => services.read('/tmp/typed.txt'),
			(value) => value.includes('rdp-actual'),
			'RDP key delivered to real xterm',
		);
		await peer.close();
		await settled();
	});
	await t.test('binary protocol frames reach real VNC with an empty stored username', async () => {
		const id = await create('VNC', 5900);
		await change(id, { username: '' });
		const peer = await connect(id, 'vnc');
		await decodedImage(peer);
		services.x('windowfocus', services.x('search', '--name', 'B10-Desktop'));
		for (const char of 'binary-actual\n') {
			const key = char === '\n' ? 0xff0d : char.codePointAt(0);
			peer.sendBinary('key', key, 1);
			peer.sendBinary('key', key, 0);
		}
		await waitFor(
			() => services.read('/tmp/typed.txt'),
			(value) => value.includes('binary-actual'),
			'binary input actual xterm',
		);
		assert.ok(peer.events.some((event) => event.kind === 'sent' && event.binary));
		await peer.close();
		await settled();
	});
	await t.test('abrupt client loss eventually releases original upstream; fresh session remains usable', async () => {
		const peer = await connect(vnc, 'vnc');
		await decodedImage(peer);
		peer.socket.terminate();
		await peer.closed;
		await settled();
		const fresh = await connect(vnc, 'vnc');
		await decodedImage(fresh);
		await fresh.close();
		await settled();
	});
	await t.test(
		'only a ready bridge records lastConnectedAt without changing configuration version or exposing secrets',
		async () => {
			const before = await get(vnc);
			const beforeRecent = recent(vnc);
			const ticket = await issue(vnc, 'vnc');
			const after = await get(vnc);
			assert.equal(after.version, before.version);
			assert.equal(recent(vnc), beforeRecent);
			const peer = peerFor(ticket);
			await peer.ready();
			await decodedImage(peer);
			await waitFor(
				() => recent(vnc),
				(timestamp) => timestamp > beforeRecent,
				'ready bridge records server milliseconds',
			);
			const connected = await get(vnc);
			assert.equal(connected.lastConnectedAt, recent(vnc));
			assert.equal(connected.version, before.version);
			assert.equal(connected.updatedAt, before.updatedAt);
			const wire = JSON.stringify(peer.events);
			for (const secret of ['b10-pass', ticket, 'nexus-bridge-id', 'encryptedPassword']) {
				assert.equal(wire.includes(secret), false);
			}
			await peer.close();
			await settled();
		},
	);
	await t.test('consumed ticket cannot be replayed', async () => {
		const ticket = await issue(vnc, 'vnc');
		const peer = peerFor(ticket);
		await peer.ready();
		await refused(ticket);
		assert.equal(peer.closeResult, undefined);
		await peer.close();
		await settled();
	});
	await t.test('simultaneous consumption admits exactly one real bridge', async () => {
		const ticket = await issue(vnc, 'vnc');
		const pair = [peerFor(ticket), peerFor(ticket)];
		await waitFor(
			() =>
				pair.map((peer) => ({
					ready: peer.events.some((item) => item.kind === 'ready'),
					closed: peer.closeResult,
				})),
			(values) =>
				values.filter((value) => value.ready).length === 1 &&
				values.filter((value) => value.closed).length === 1,
			'one admitted and one refused',
		);
		assert.equal(services.connections(), 1);
		await Promise.all(pair.map((peer) => peer.close()));
		await settled();
	});
	await t.test('same administrator with another login cookie cannot consume original ticket', async () => {
		const ticket = await issue(vnc, 'vnc');
		const second = await f.api('POST', '/api/v1/auth/login', {
			username: 'admin',
			password: f.password,
			rememberMe: false,
		});
		expectStatus(second, 200);
		const cookie = second.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
		await refused(ticket, { Cookie: cookie });
		const original = peerFor(ticket);
		await original.ready();
		await original.close();
		await settled();
	});
	await t.test('raw upgrade rejects missing cookie, cross-origin, wrong Host and malformed ticket', async () => {
		const ticket = await issue(vnc, 'vnc');
		for (const [value, headers] of [
			[ticket, { Cookie: '' }],
			[ticket, { Origin: 'https://other.invalid' }],
			[ticket, { Host: 'other.invalid' }],
			['bad', {}],
			[ticket + '&ticket=' + ticket, {}],
			[ticket + '&extra=1', {}],
		]) {
			const peer = peerFor(value, headers);
			await peer.closed;
			assert.ok(peer.upgradeStatus === 401 || peer.upgradeStatus === 403);
		}
		const original = peerFor(ticket);
		await original.ready();
		await original.close();
		await settled();
	});
	for (const field of ['name', 'host', 'port', 'type']) {
		await t.test('target ' + field + ' change invalidates an unused ticket', async () => {
			const id = await create('VNC', 5900);
			const ticket = await issue(id, 'vnc');
			await change(id, { [field]: { name: 'renamed', host: '127.0.0.1', port: 5901, type: 'RDP' }[field] });
			await refused(ticket, {}, 1011);
			await settled();
		});
	}
	await t.test('credential update invalidates ticket bound to old configuration version', async () => {
		const id = await create('VNC', 5900);
		const ticket = await issue(id, 'vnc');
		expectStatus(
			await f.api('PUT', base + '/' + id + '/credential', {
				version: (await get(id)).version,
				credential: { kind: 'password', password: 'new-secret' },
			}),
			200,
		);
		await refused(ticket, {}, 1011);
		await settled();
	});
	await t.test('target deletion invalidates unused ticket', async () => {
		const id = await create('VNC', 5900);
		const ticket = await issue(id, 'vnc');
		expectStatus(await f.api('DELETE', base + '/' + id), 200);
		await refused(ticket, {}, 1011);
		await settled();
	});
	await t.test('proxy-marked desktop is refused before creating a direct bridge', async () => {
		const proxy = expectStatus(
			await f.api('POST', '/api/v1/targets/proxies', {
				name: 'unused',
				type: 'HTTP',
				host: '127.0.0.1',
				port: 1,
				username: null,
			}),
			201,
		);
		const id = await create('VNC', 5900);
		await change(id, { route: 'proxy', proxyId: proxy.id });
		expectStatus(await f.api('POST', path(id, 'vnc')), 400);
		await settled();
	});
	await t.test('sixteen real sessions survive seventeenth refusal; capacity returns after actual close', async () => {
		const active = [];
		// Keep sixteen real sessions live, without overflowing Xvnc's small
		// TCP accept backlog with sixteen unauthenticated handshakes at once.
		for (let count = 0; count < 16; count++) {
			const peer = await connect(vnc, 'vnc');
			await decodedImage(peer);
			active.push(peer);
		}
		await waitFor(
			() => services.connections(),
			(count) => count === 16,
			'sixteen real VNC connections',
		);
		const ticket = await issue(vnc, 'vnc');
		await refused(ticket, {}, 1013);
		assert.equal(active.filter((peer) => peer.closeResult === undefined).length, 16);
		await Promise.all(active.map((peer) => peer.close()));
		await settled();
		// Refusing a full slot does not consume an otherwise valid ticket.
		const retry = peerFor(ticket);
		await retry.ready();
		await retry.close();
		await settled();
	});
	await t.test('wrong remote password returns safe failure and leaves no server connection', async () => {
		const id = await create('VNC', 5900, 'incorrect');
		const peer = peerFor(await issue(id, 'vnc'));
		await peer.closed;
		assert.equal(JSON.stringify(peer.events).includes('incorrect'), false);
		await settled();
		const healthy = await connect(vnc, 'vnc');
		await healthy.close();
		await settled();
	});
	await t.test(
		'desktop server termination closes real peer; restart accepts a fresh independently issued ticket',
		async () => {
			const peer = await connect(vnc, 'vnc');
			services.stopDesktop();
			await peer.closed;
			await settled();
			const unavailable = peerFor(await issue(vnc, 'vnc'));
			await unavailable.closed;
			assert.equal(
				unavailable.events.some((item) => item.kind === 'ready'),
				false,
			);
			assert.equal(JSON.stringify(unavailable.events).includes('b10-pass'), false);
			await services.startDesktop();
			await waitFor(
				() => services.x('search', '--name', 'B10-Desktop'),
				(value) => value.length > 0,
				'desktop restarted',
			);
			const fresh = await connect(vnc, 'vnc');
			await fresh.close();
			await settled();
		},
	);
	await t.test('real service logs contain neither stored password nor private bridge settings', async () => {
		const logs = services.logs();
		for (const secret of ['b10-pass', 'new-secret', 'nexus-bridge-id']) {
			assert.equal(logs.includes(secret), false);
		}
		assert.deepEqual(warnings, []);
	});
});
