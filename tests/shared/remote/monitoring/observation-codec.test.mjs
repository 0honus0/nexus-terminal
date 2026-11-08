import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readRemoteStatusSample } from '@nexus-terminal/shared/remote/monitoring/http-codec';
import {
	readWorkspaceStatusError,
	readWorkspaceObservationEmpty,
} from '@nexus-terminal/shared/remote/monitoring/workspace-codec';
import {
	readWorkspaceDockerStatusResponse,
	readWorkspaceDockerStatsResponse,
} from '@nexus-terminal/shared/remote/docker/workspace-codec';

test('observation codecs reject malformed samples, unsafe Docker identity and oversized stats', () => {
	const stats = {
		id: 'abcdef012345',
		name: 'fixture',
		cpuPercent: '0%',
		memoryUsage: '1MiB / 1GiB',
		memoryPercent: '0.1%',
		networkIo: '0B / 0B',
		blockIo: '0B / 0B',
		pids: '1',
	};
	const container = {
		id: 'abcdef0123456789',
		names: ['fixture'],
		image: 'alpine',
		imageId: 'sha256:example',
		command: 'sh',
		created: '2026-10-18',
		state: 'running',
		status: 'Up',
		ports: [{ privatePort: 80, type: 'tcp' }],
		labels: 'fixture=yes',
		stats,
	};
	const checks = [];

	const rejects = (fn, name) => {
		assert.throws(fn);
		checks.push(name);
	};

	rejects(() => readRemoteStatusSample({ timestamp: 1, cpuPercent: NaN }), 'nonfinite sample');
	rejects(() => readRemoteStatusSample({ timestamp: 1, secret: 'hidden' }), 'extra sample field');
	rejects(() => readRemoteStatusSample({ timestamp: 1, loadAvg: [1, 2] }), 'load tuple');
	rejects(() => readWorkspaceStatusError({ message: 'raw diagnostic' }), 'unbounded error');
	rejects(() => readWorkspaceStatusError({ message: 'forbidden', cause: 'hidden' }), 'extra error field');
	rejects(() => readWorkspaceObservationEmpty(null), 'null request');
	rejects(
		() => readWorkspaceDockerStatusResponse({ available: false, containers: [container] }),
		'unavailable with containers',
	);
	rejects(
		() => readWorkspaceDockerStatusResponse({ available: true, containers: [container, container] }),
		'duplicate container',
	);
	rejects(
		() =>
			readWorkspaceDockerStatusResponse({
				available: true,
				containers: [{ ...container, id: 'x;touch /tmp/never' }],
			}),
		'unsafe identifier',
	);
	rejects(
		() =>
			readWorkspaceDockerStatusResponse({
				available: true,
				containers: [{ ...container, stats: { ...stats, id: 'foreign' } }],
			}),
		'foreign nested stats',
	);
	rejects(() => readWorkspaceDockerStatsResponse({ ...stats, name: 'x'.repeat(65537) }), 'stats text budget');
	assert.equal(
		readWorkspaceDockerStatusResponse({ available: true, containers: [container] }).containers[0].labels,
		'fixture=yes',
	);
	checks.push('native string labels');
	assert.equal(readWorkspaceDockerStatsResponse(null), null);
	checks.push('absent stats');
});
