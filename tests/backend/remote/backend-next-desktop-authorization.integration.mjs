import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDesktopManagement } from './desktop-management-fixture.mjs';
import { expectStatus } from './openssh-fixture.mjs';
import { waitFor } from './desktop-fixture.mjs';

await test('B10 real desktop authority polling and application lifecycle', { timeout: 60000 }, async (t) => {
	const { f, services, create, vnc, rdp, change, issue, peerFor, connect, settled, refused, decodedImage } =
		await openDesktopManagement(t, 'authorization');
	await t.test('real authorization poll closes active desktop after target configuration change', async () => {
		const id = await create('VNC', 5900);
		const peer = await connect(id, 'vnc');
		await decodedImage(peer);
		await change(id, { name: 'revoked active configuration' });
		await waitFor(
			() => peer.closeResult,
			(value) => value !== undefined,
			'active target revocation poll',
			18000,
		);
		await settled();
	});
	await t.test('logout closes active desktop at poll and refuses unused ticket with revoked cookie', async () => {
		const peer = await connect(vnc, 'vnc');
		await decodedImage(peer);
		const ticket = await issue(vnc, 'vnc');
		expectStatus(await f.api('POST', '/api/v1/auth/logout'), 200);
		const unused = peerFor(ticket);
		await unused.closed;
		assert.equal(unused.upgradeStatus, 401);
		await waitFor(
			() => peer.closeResult,
			(value) => value !== undefined,
			'active session logout poll',
			18000,
		);
		await settled();
		await f.login();
	});
	await t.test('application shutdown closes active VNC and RDP; restart cannot revive old tickets', async () => {
		const active = await Promise.all([connect(vnc, 'vnc'), connect(rdp, 'rdp')]);
		for (const peer of active) {
			await decodedImage(peer);
		}
		assert.equal(services.connections(), 2);
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
