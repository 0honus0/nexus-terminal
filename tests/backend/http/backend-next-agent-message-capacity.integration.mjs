import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { listAgentApprovalHistory } from './agent-approval-fixture.mjs';
import { openSshd, until, expectStatus } from '../remote/openssh-fixture.mjs';

await test(
	'Collaboration capacity: byte-bound message pages never authorize consumption of undelivered messages',
	{ timeout: 90000 },
	async (t) => {
		const directory = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'message-capacity-'));
		const sshd = await openSshd(directory);
		t.after(() => sshd.close());
		const f = await openAgentExecution(directory, sshd, {
			contextWindow: 1048576,
			discover:
				'collaboration_delegate collaboration_message_send collaboration_message_read collaboration_message_consume',
		});
		t.after(() => f.close());
		await f.grants(['app.intents.exchange', 'context.read']);
		let settings = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
		const confirmation = expectStatus(
			await f.api('POST', '/api/v1/agent/execution-settings/hard-limits/preview', {
				expectedVersion: settings.version,
				proposed: { ...settings.hardLimits, maxToolOutputBytes: 1048576 },
			}),
			200,
		).confirmation;
		settings = expectStatus(
			await f.api('POST', '/api/v1/agent/execution-settings/hard-limits/confirm', {
				confirmationId: confirmation.id,
			}),
			200,
		).settings;
		expectStatus(
			await f.api('PUT', '/api/v1/agent/execution-settings', {
				expectedVersion: settings.version,
				enabled: true,
				limits: { ...settings.limits, maxToolOutputBytes: 1048576, maxMessageBytes: 2097152 },
			}),
			200,
		);
		const body = '"\\\n😀'.repeat(14000);
		let childId, release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		t.after(() => release());
		const pages = [];
		const objective = f.program('read large mailbox', async (results) => {
			await gate;
			switch (results.length) {
				case 0:
					return { name: 'collaboration_message_consume', input: { through: 3, expectedConsumed: 0 } };
				case 1:
					assert.match(JSON.stringify(results[0]), /version_conflict/);
					return { name: 'collaboration_message_read', input: { after: 0, limit: 100 } };
				case 2: {
					const page = results[1];
					pages.push(page);
					assert.equal(page.messages.length, 2);
					assert.equal(page.nextCursor, 2);
					assert.equal(page.consumedThrough, 0);
					assert.ok(page.messages.every((message) => message.body === body));
					return { name: 'collaboration_message_consume', input: { through: 3, expectedConsumed: 0 } };
				}
				case 3:
					assert.match(JSON.stringify(results[2]), /version_conflict/);
					return { name: 'collaboration_message_consume', input: { through: 2, expectedConsumed: 0 } };
				case 4:
					assert.equal(results[3].consumedThrough, 2);
					return { name: 'collaboration_message_read', input: { after: 2, limit: 100 } };
				case 5: {
					const page = results[4];
					pages.push(page);
					assert.equal(page.messages.length, 1);
					assert.equal(page.messages[0].body, body);
					assert.equal(page.nextCursor, 3);
					assert.equal(page.consumedThrough, 2);
					return { name: 'collaboration_message_consume', input: { through: 3, expectedConsumed: 2 } };
				}
				default:
					assert.equal(results[5].consumedThrough, 3);
					return {};
			}
		});
		const root = await f.start('send three large messages', (results) => {
			if (!results.length)
				return {
					name: 'collaboration_delegate',
					input: { profile: 'explore', objective, dependencyMode: 'success' },
				};
			childId = results[0].id;
			if (results.length > 1) assert.ok(!results.at(-1).failure, JSON.stringify(results.at(-1)));
			if (results.length <= 3)
				return { name: 'collaboration_message_send', input: { recipientId: childId, body, ttlSeconds: 3600 } };
			release();
			return { hold: true };
		});
		await until(
			async () => {
				for (const run of [root.id, childId].filter(Boolean))
					for (const approval of await listAgentApprovalHistory(f.api, f.appId, run))
						if (approval.status === 'requested') await f.approve(approval);
				if (!childId) return null;
				return expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + childId), 200);
			},
			(run) => run && ['completed', 'failed', 'cancelled', 'unknown'].includes(run.status),
			'large mailbox child settles',
			60000,
		).then((run) => assert.equal(run.status, 'completed', JSON.stringify(run)));
		assert.deepEqual(
			pages.flatMap((page) => page.messages.map((message) => message.sequence)),
			[1, 2, 3],
		);
		const db = new DatabaseSync(f.database, { readOnly: true });
		try {
			assert.deepEqual(
				{
					...db
						.prepare('SELECT consumed_through,read_through FROM agent_run_mailbox_cursors WHERE run_id=?')
						.get(childId),
				},
				{ consumed_through: 3, read_through: 3 },
			);
			assert.equal(
				db.prepare('SELECT COUNT(*) AS total FROM agent_run_mailbox WHERE recipient_id=?').get(childId).total,
				3,
				'consumption retains the original messages',
			);
		} finally {
			db.close();
		}
		f.finishModels();
		await f.wait(root, 'completed');
	},
);
