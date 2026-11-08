import assert from 'node:assert/strict';
import { test } from 'vitest';
import en from '../../../../packages/frontend/src/features/agent/i18n/en-US.json';
import zh from '../../../../packages/frontend/src/features/agent/i18n/zh-CN.json';
import ja from '../../../../packages/frontend/src/features/agent/i18n/ja-JP.json';
import { AGENT_TOOL_HOST_OPERATIONS } from '../../../../packages/shared/src/agent/plugins/values.ts';
import {
	formatToolSummary,
	formatToolTargets,
	toolCommandPreview,
	toolDisplayName,
} from '../../../../packages/frontend/src/features/agent/runtime/native-tool-summary.ts';

const catalogs = [en, zh, ja];

function pluginIdentity(packageId, name) {
	return { kind: 'plugin', packageId, packageVersion: '2.0.0', packageSha256: 'a'.repeat(64), name };
}

function translator(catalog) {
	const lookup = (key) => key.split('.').reduce((value, part) => value?.[part], catalog);

	return {
		has: (key) => typeof lookup(key) === 'string',

		translate(key, named = {}) {
			const value = lookup(key);
			assert.equal(typeof value, 'string', `Missing translation: ${key}`);
			return value.replace(/\{([^}]+)\}/gu, (_, name) => named[name] ?? `{${name}}`);
		},
	};
}

test('Delegation approvals describe the actual child task and all authoritative SSH targets in every locale', () => {
	const summary = JSON.stringify({
		action: 'delegate',
		profile: 'remote-files-read',
		targets: [11, 22],
		objectiveBytes: 35,
		command: 'Read project files; do not modify them.',
		commandTruncated: false,
	});
	for (const catalog of catalogs) {
		const text = formatToolSummary(
			summary,
			{ kind: 'host', operation: 'collaboration.delegate' },
			translator(catalog),
		);
		assert.match(text, /remote-files-read/u);
		assert.match(text, /11, 22/u);
		assert.doesNotMatch(text, /objectiveBytes|commandTruncated|\{"/u);
	}
	assert.equal(
		formatToolTargets(
			summary,
			null,
			new Map([
				[11, 'Staging'],
				[22, 'Production'],
			]),
		),
		'Staging, Production',
	);
	assert.deepEqual(toolCommandPreview(summary), {
		text: 'Read project files; do not modify them.',
		truncated: false,
	});
});

test('Invalid target projections cannot impersonate a single authorized target', () => {
	for (const targets of [[1, '2'], [1, 1], [0], [-1], [1.5], { id: 1 }]) {
		assert.equal(formatToolTargets(JSON.stringify({ action: 'delegate', targets }), null, new Map()), '—');
	}
	assert.equal(formatToolTargets('{"action":"execute"}', 11, new Map([[11, 'Staging']])), 'Staging');
	assert.equal(formatToolTargets('{"action":"delegate","targets":[22]}', null, new Map()), '22');
});

test('Execution previews preserve line breaks and truncation while legacy text stays out of structured UI', () => {
	const command = 'printf first\nprintf second';
	const summary = JSON.stringify({
		action: 'execute',
		mode: 'foreground',
		bytes: 31,
		command,
		commandTruncated: true,
	});
	assert.deepEqual(toolCommandPreview(summary), { text: command, truncated: true });
	assert.equal(toolCommandPreview('legacy fallback description'), null);
	assert.equal(
		formatToolSummary(
			'legacy fallback description',
			{ kind: 'host', operation: 'shell.execute' },
			translator(catalogs[0]),
		),
		'Execute command',
	);
});

test('Only persisted Host operation identity assigns a category; same-named plugin tools retain their source', () => {
	const identity = pluginIdentity('third.party', 'shell_execute');
	assert.equal(toolDisplayName(identity), 'third.party / shell_execute');
	assert.equal(
		formatToolSummary('Plugin arguments are not operation metadata.', identity, translator(catalogs[0])),
		'Operation recorded',
	);
	assert.equal(
		formatToolSummary('{"packageId":"third.party","name":"shell_execute"}', identity, translator(catalogs[0])),
		'Operation recorded',
	);
	assert.equal(
		toolDisplayName({ kind: 'host', operation: 'shell.execute' }, translator(catalogs[0])),
		'Execute command',
	);
});

test('Every finite Host operation has a readable label in every installed UI locale', () => {
	for (const catalog of catalogs) {
		for (const operation of AGENT_TOOL_HOST_OPERATIONS) {
			const identity = { kind: 'host', operation };
			const label = toolDisplayName(identity, translator(catalog));
			assert.notEqual(label, operation, `Untranslated Host operation: ${operation}`);
			assert.equal(formatToolSummary('{}', identity, translator(catalog)), label);
		}
	}
});
