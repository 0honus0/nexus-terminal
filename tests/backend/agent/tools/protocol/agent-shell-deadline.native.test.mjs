import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

// The Host deadline needs neither model startup nor discovery. Exercise it with
// a signed minimal App and real SSH, preserving the original three-second budget.
const backend = `import { definePlugin } from './sdk.mjs';
export default definePlugin((plugin) => plugin.register({kind:'app', key:'test.deadline.run',
contract:'test.deadline', apiVersion:1, summary:'Yielded command deadline', instructions:'',
inputSchemaJson:'{"type":"object"}', resultSchemaJson:'{"type":"object"}',
capabilities:['shell.execute'], tags:[], execution:'managed'}, async (_input, context) => {
 const info = await context.run.describe();
 const request = JSON.parse(info.inputJson);
 const started = await context.perform('execute', request);
 await context.perform('wait', {operation:'shell.jobs', connectionId:request.connectionId,
 action:'wait', jobIds:[started.value.jobId], waitMode:'all', waitSeconds:30, offset:0});
 return {kind:'complete', outputs:[]};
}));`;

await test(
	'original Run deadline still stops yielded execution and preserves unknown',
	{ timeout: 120000 },
	async (t) => {
		const directory = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'shell-deadline-'));
		const sshd = await openSshd(directory);
		t.after(() => sshd.close());
		const f = await openAgentExecution(directory, sshd, {
			signal: t.signal,
			plugin: { packageId: 'test.deadline', selectedRootIds: [], backend },
		});
		const cleanup = { unknown: false };
		t.after(() => f.close(cleanup));
		const settings = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
		expectStatus(
			await f.api('PUT', '/api/v1/agent/execution-settings', {
				expectedVersion: settings.version,
				enabled: true,
				limits: { ...settings.limits, maxActiveSeconds: 3, toolTimeoutSeconds: 1 },
			}),
			200,
		);
		const effect = join(directory, 'deadline-started');
		const finished = join(directory, 'deadline-finished');
		const run = await f.start('hard Run deadline', () => assert.fail('This Host deadline does not use a model'), {
			inputJson: JSON.stringify({
				operation: 'shell.execute',
				connectionId: f.connectionId,
				commands: [`trap '' HUP TERM; printf x > '${effect}'; sleep 4; printf done > '${finished}'`],
				onError: 'stop',
				cwd: null,
				mode: 'foreground',
				yieldSeconds: 0,
			}),
		});
		await f.approve(await f.approval(run, 'shell_execute'));
		await until(
			() => f.rows('agent_tool_jobs', run)[0]?.state,
			(state) => state === 'unknown',
			'Execution budget preserves unknown',
			t.signal,
		);
		cleanup.unknown = true;
		assert.equal(await readFile(effect, 'utf8'), 'x');
		assert.equal(expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items[0].state, 'blocked');
		await until(
			async () => {
				try {
					return await readFile(finished, 'utf8');
				} catch (error) {
					if (error.code === 'ENOENT') {
						return null;
					}
					throw error;
				}
			},
			(value) => value === 'done',
			'Deadline fixture process independently ended',
			t.signal,
		);
	},
);
