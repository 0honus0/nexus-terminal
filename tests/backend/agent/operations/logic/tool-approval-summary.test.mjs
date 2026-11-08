import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { hostOperationSummary } from '../../../../../packages/backend/src/modules/agent/tools/service/host-operation-summary.ts';
import { hostOperationDefinition } from '../../../../../packages/backend/src/modules/agent/tools/host-operation-rules.ts';
import { AGENT_APPROVAL_MAX_SUMMARY_BYTES } from '../../../../../packages/shared/src/agent/governance/values.ts';

const sha = (value) => createHash('sha256').update(value).digest('hex');

const summary = (input, name) => {
	const definition = hostOperationDefinition(name);
	assert.ok(definition, name);
	const raw = hostOperationSummary(input, definition);
	assert.ok(Buffer.byteLength(raw) <= AGENT_APPROVAL_MAX_SUMMARY_BYTES);
	return { raw, value: JSON.parse(raw) };
};

await test('Approval summary: delegation shows actual authority and Unicode-safe bounded objective with complete evidence', () => {
	const prefix = '审查目录 "quoted" \\escaped\nemoji 👩🏽‍💻🙂 ';
	const objective = prefix.repeat(100);
	assert.ok(Buffer.byteLength(objective) <= 8192, 'fixture respects the real delegation objective input budget');
	const input = {
		kind: 'collaboration',
		input: {
			action: 'delegate',
			profile: 'explore',
			objective,
			targets: ['17', '23'],
			dependencies: [],
			dependencyMode: 'success',
		},
	};
	const { raw, value } = summary(input, 'collaboration.delegate');
	assert.ok(Buffer.byteLength(raw) <= 2048);
	assert.equal(value.profile, 'explore');
	assert.deepEqual(value.targets, ['17', '23']);
	assert.equal(value.objectiveBytes, Buffer.byteLength(objective));
	assert.equal(value.objectiveSha256, sha(objective));
	assert.equal(value.commandTruncated, true);
	assert.ok(objective.startsWith(value.command));
	assert.ok(value.command.includes(prefix));
	assert.doesNotMatch(value.command, /[\uD800-\uDBFF]$/u, 'never ends with half a surrogate pair');
	const short = summary({ ...input, input: { ...input.input, objective: prefix } }, 'collaboration.delegate').value;
	assert.equal(short.command, prefix);
	assert.equal(short.commandTruncated, false);
	assert.notEqual(short.objectiveSha256, value.objectiveSha256);
});

await test('Approval summary: move destination, delete scope and artifact identity remain reviewable without artifact body', () => {
	const moved = summary(
		{
			kind: 'move',
			connectionId: 17,
			items: [{ path: '/src/原始.txt', destinationPath: '/dst/最终.txt', expectedFingerprint: 'a'.repeat(64) }],
			onError: 'stop',
		},
		'remote.move',
	).value;
	assert.equal(moved.command, '/src/原始.txt → /dst/最终.txt');
	const removed = summary(
		{
			kind: 'delete',
			connectionId: 17,
			items: [{ path: '/archive', scope: 'tree', expectedFingerprint: 'b'.repeat(64) }],
			onError: 'stop',
		},
		'remote.delete',
	).value;
	assert.equal(removed.command, '/archive (tree)');
	const content = 'PRIVATE_ARTIFACT_BODY 中文🙂';
	const artifact = summary(
		{
			kind: 'artifact',
			action: 'create',
			name: '审查报告.md',
			mediaType: 'text/markdown',
			base64: Buffer.from(content).toString('base64'),
		},
		'artifacts.create',
	);
	assert.equal(artifact.value.name, '审查报告.md');
	assert.equal(artifact.value.bytes, Buffer.byteLength(content));
	assert.equal(artifact.value.sha256, sha(content));
	assert.ok(!artifact.raw.includes(content));
	assert.ok(!('content' in artifact.value));
});

await test('Approval summary: existing shell approval preserves actual command order, cwd and complete command identity', () => {
	const commands = ['printf "%s\\n" "中文🙂"', 'pwd'];
	const value = summary(
		{
			kind: 'shell',
			connectionId: 17,
			commands,
			onError: 'stop',
			cwd: '/srv/project',
			mode: 'foreground',
			yieldSeconds: null,
		},
		'shell.execute',
	).value;
	assert.equal(value.command, '1. ' + commands[0] + '\n2. ' + commands[1]);
	assert.equal(value.cwd, '/srv/project');
	assert.equal(value.commandTruncated, false);
	assert.equal(value.sha256, sha(JSON.stringify(commands)));
});
