import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDesktopManagement } from '../support/desktop-management-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

await test('B10 desktop ticket capacity and expiry', { timeout: 60000 }, async (t) => {
	const { f, services, vnc, path, issue, connect, settled, refused } = await openDesktopManagement(t, 'tickets');
	let lastCapacityTicket;
	await t.test('1024 pending tickets fill exact capacity without dispatch; 1025th is rejected', async () => {
		await f.restart();
		await settled();
		for (let count = 0; count < 1024; count++) {
			lastCapacityTicket = await issue(vnc, 'vnc');
		}
		expectStatus(await f.api('POST', path(vnc, 'vnc')), 429);
		assert.equal(await services.connections(), 0);
	});
	await t.test('thirty-second expiry prunes full capacity and rejects old ticket', async () => {
		t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
		t.mock.timers.tick(30100);
		assert.ok(lastCapacityTicket);
		await refused(lastCapacityTicket);
		const fresh = await connect(vnc, 'vnc');
		await fresh.close();
		await settled();
	});
});
