import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDesktopManagement } from '../support/desktop-management-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

await test('B10 real desktop authority polling and application lifecycle', { timeout: 60000 }, async (t) => {
	const { f, services, create, vnc, rdp, change, issue, rawPeerFor, connect, settled, refused, decodedImage } =
		await openDesktopManagement(t, 'authorization');
	await t.test('real authorization poll closes active desktop after target configuration change', async (t) => {
		const id = await create('VNC', 5900);
		// Only intervals created by this connection run virtually. Browser rendering,
		// TCP, HTTP and bridge shutdown retain their actual clocks and acknowledgements.
		t.mock.timers.enable({ apis: ['setInterval'] });
		const peer = await connect(id, 'vnc');
		await decodedImage(peer);
		await change(id, { name: 'revoked active configuration' });
		t.mock.timers.tick(14_999);
		assert.equal(peer.closeResult, undefined);
		assert.equal(await services.connections(), 1);
		t.mock.timers.tick(1);
		await peer.closed;
		await settled();
	});
	await t.test('logout closes active desktop at poll and refuses unused ticket with revoked cookie', async (t) => {
		t.mock.timers.enable({ apis: ['setInterval'] });
		const peer = await connect(vnc, 'vnc');
		await decodedImage(peer);
		const ticket = await issue(vnc, 'vnc');
		expectStatus(await f.api('POST', '/api/v1/auth/logout'), 200);
		const unused = rawPeerFor(ticket);
		await unused.closed;
		assert.equal(unused.upgradeStatus, 401);
		t.mock.timers.tick(14_999);
		assert.equal(peer.closeResult, undefined);
		assert.equal(await services.connections(), 1);
		t.mock.timers.tick(1);
		await peer.closed;
		await settled();
		await f.login();
	});
	await t.test('application shutdown closes active VNC and RDP; restart cannot revive old tickets', async () => {
		const active = await Promise.all([connect(vnc, 'vnc'), connect(rdp, 'rdp')]);
		for (const peer of active) {
			await decodedImage(peer);
		}
		assert.equal(await services.connections(), 2);
		const ticket = await issue(vnc, 'vnc');
		await f.restart();
		await Promise.all(active.map((peer) => peer.closed));
		await settled();
		await refused(ticket);
		const fresh = await connect(vnc, 'vnc');
		await fresh.close();
		await settled();
	});
});
