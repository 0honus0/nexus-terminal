import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

await test('Resource lifecycle: authenticated HTTP close confirms, durably cancels and drains a real running Agent', async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-agent-resources-'));
	const sshd = await openSshd(root);
	let f;
	t.after(async () => {
		try {
			await f?.close();
		} finally {
			await sshd.close();
		}
	});
	f = await openAgentExecution(root, sshd, { plugin: { selectedRootIds: [], uiPackageId: null } });
	const run = await f.start('close running task', () => ({ hold: true }));
	await until(
		() => f.heldModelCount,
		(count) => count === 1,
		'real model stream established',
	);
	const app = expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId), 200);
	const path = '/api/v1/agent/apps/' + f.appId + '/resources/close';
	const request = { appVersion: app.version, target: { kind: 'app' }, confirmed: false };
	const preview = expectStatus(await f.api('POST', path, request), 200);
	assert.equal(preview.status, 'confirmation_required');
	assert.equal(preview.activeRuns, 1);
	assert.equal(f.rows('agent_runs', run)[0].status, 'running');
	const result = expectStatus(await f.api('POST', path, { ...request, confirmed: true }), 200);
	assert.equal(result.status, 'closed');
	await f.wait(run, 'cancelled');
	assert.equal(
		expectStatus(await f.api('POST', path, { ...request, appVersion: app.version + 1 }), 409).code,
		'version_conflict',
	);
	assert.equal(expectStatus(await f.api('POST', path, { ...request, confirmed: true }), 200).status, 'closed');
});
