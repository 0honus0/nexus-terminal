import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	readAgentPluginUiEnvironment,
	readAgentPluginUiHostFailure,
	readAgentPluginUiHostInput,
	readAgentPluginUiHostResult,
} from '../../../../packages/shared/src/agent/plugins/ui-events-codec.ts';
import {
	readAgentPluginUiInput,
	readAgentPluginUiResult,
} from '../../../../packages/shared/src/agent/plugins/ui-http-codec.ts';

const appId = '10000000-0000-4000-8000-000000000001';
const otherAppId = '10000000-0000-4000-8000-000000000002';
const artifactId = '20000000-0000-4000-8000-000000000001';
const key = '30000000-0000-4000-8000-000000000001';
const otherKey = '30000000-0000-4000-8000-000000000002';
const selection = {
	key,
	id: artifactId,
	name: 'animation.gif',
	version: 7,
	sha256: 'a'.repeat(64),
	mediaType: 'image/gif',
	sizeBytes: 42,
};

function rangeRequest() {
	return readAgentPluginUiInput({
		method: 'agent.artifacts.readRange',
		params: { artifactId, expectedVersion: 7, start: 0, endInclusive: 0 },
	});
}

function rangeResult() {
	return {
		appId,
		method: 'agent.artifacts.readRange',
		value: { artifactId, start: 0, endInclusive: 0, dataBase64: 'AA==', version: 7, totalBytes: 1 },
	};
}

test('Artifact reads reject caller scopes and bind returned bytes to App, version and exact range', () => {
	const request = rangeRequest();
	assert.deepEqual(readAgentPluginUiResult(rangeResult(), request, appId), rangeResult());
	assert.throws(() => readAgentPluginUiInput({ ...request, params: { ...request.params, appId: otherAppId } }));
	assert.throws(() => readAgentPluginUiResult({ ...rangeResult(), appId: otherAppId }, request, appId));
	for (const mutation of [{ version: 8 }, { start: 1 }, { endInclusive: 1 }, { totalBytes: 0 }]) {
		const result = rangeResult();
		assert.throws(() =>
			readAgentPluginUiResult({ ...result, value: { ...result.value, ...mutation } }, request, appId),
		);
	}
});

test('Artifact binary responses require canonical base64 and exact decoded byte count', () => {
	const result = rangeResult();
	for (const dataBase64 of ['AB==', 'AAA=', 'AA', '!!!!', 'AA==\n']) {
		assert.throws(() =>
			readAgentPluginUiResult({ ...result, value: { ...result.value, dataBase64 } }, rangeRequest(), appId),
		);
	}
});

test('Host attachment inputs contain only opaque keys, a local anchor and the chosen target Thread', () => {
	const open = { kind: 'artifact.selection.open', anchor: { left: 1.5, top: 0, width: 28, height: 44 }, keys: [key] };
	assert.deepEqual(readAgentPluginUiHostInput(open), open);
	assert.throws(() => readAgentPluginUiHostInput({ ...open, keys: [key, key] }));
	assert.throws(() => readAgentPluginUiHostInput({ ...open, appId: otherAppId }));
	for (const anchor of [
		{ ...open.anchor, left: Infinity },
		{ ...open.anchor, top: NaN },
		{ ...open.anchor, width: -1 },
	]) {
		assert.throws(() => readAgentPluginUiHostInput({ ...open, anchor }));
	}
	assert.throws(() =>
		readAgentPluginUiHostInput({
			kind: 'artifact.selection.attach',
			key,
			threadId: artifactId,
			expectedVersion: 9,
		}),
	);
});

test('Host attachment results reject foreign metadata, duplicate selections and mismatched keys', () => {
	const read = { kind: 'artifact.selection.read', keys: [key] };
	assert.deepEqual(readAgentPluginUiHostResult({ kind: read.kind, selections: [selection] }, read, appId), {
		kind: read.kind,
		selections: [selection],
	});
	assert.throws(() => readAgentPluginUiHostResult({ kind: read.kind, selections: [] }, read, appId));
	assert.throws(() =>
		readAgentPluginUiHostResult({ kind: read.kind, selections: [{ ...selection, key: otherKey }] }, read, appId),
	);
	assert.throws(() =>
		readAgentPluginUiHostResult(
			{ kind: read.kind, selections: [{ ...selection, appId: otherAppId }] },
			read,
			appId,
		),
	);
	for (const mutation of [
		{ version: 0 },
		{ sha256: 'invalid' },
		{ mediaType: 'image/gif\\r\\nX: injected' },
		{ sizeBytes: -1 },
	]) {
		assert.throws(() =>
			readAgentPluginUiHostResult({ kind: read.kind, selections: [{ ...selection, ...mutation }] }, read, appId),
		);
	}
	const open = { kind: 'artifact.selection.open', anchor: { left: 0, top: 0, width: 28, height: 28 }, keys: [] };
	assert.throws(() =>
		readAgentPluginUiHostResult({ kind: open.kind, selections: [selection, selection] }, open, appId),
	);
	const attach = { kind: 'artifact.selection.attach', key, threadId: artifactId };
	assert.throws(() =>
		readAgentPluginUiHostResult({ kind: attach.kind, selection: { ...selection, key: otherKey } }, attach, appId),
	);
});

test('Host failure decoding preserves named failure and dispatch outcome without error text', () => {
	for (const code of ['cancelled', 'request_failed', 'protocol_failure', 'version_conflict', 'operation_unknown']) {
		for (const outcome of ['not_dispatched', 'confirmed', 'unknown']) {
			assert.deepEqual(readAgentPluginUiHostFailure({ code, outcome }), { code, outcome });
		}
	}
	assert.throws(() => readAgentPluginUiHostFailure({ code: 'unknown_error', outcome: 'unknown' }));
	assert.throws(() => readAgentPluginUiHostFailure({ code: 'cancelled', outcome: 'rolled_back' }));
	assert.throws(() => readAgentPluginUiHostFailure({ code: 'forbidden', outcome: 'confirmed', message: 'private' }));
});

test('Presentation environment preserves unlimited image preview while rejecting duplicate target identities', () => {
	const environment = {
		appId,
		appVersion: 2,
		checkpoint: null,
		active: true,
		minimized: false,
		compact: false,
		executionEnabled: true,
		resumeRevision: 0,
		locale: 'en-US',
		dark: false,
		themeVariables: [],
		imagePreviewMaxMiB: 0,
		targets: [{ id: 1, name: 'Host', host: 'example.test', username: 'user' }],
		preferredTargetIds: [2],
	};
	assert.deepEqual(readAgentPluginUiEnvironment(environment), environment);
	assert.throws(() =>
		readAgentPluginUiEnvironment({ ...environment, targets: [environment.targets[0], environment.targets[0]] }),
	);
	assert.throws(() => readAgentPluginUiEnvironment({ ...environment, userId: 1 }));
});
