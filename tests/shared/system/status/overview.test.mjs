import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readLocalSystemStatus, readLocalSystemStatusError } from '@nexus-terminal/shared/system/status/http-codec';
import { readObservationError, readSshResourceStatusList } from '@nexus-terminal/shared/remote/monitoring/http-codec';

test('system measurements reject malformed status, private errors and conflicting host identities', () => {
	const codecChecks = [];

	function rejects(action, name) {
		assert.throws(action);
		codecChecks.push(name);
	}

	for (const value of [null, [], { code: 'stderr-secret' }, { code: 'forbidden', secret: true }, { code: 403 }]) {
		rejects(() => readLocalSystemStatusError(value), 'invalid local failure');
		rejects(() => readObservationError(value), 'invalid observation failure');
	}
	assert.equal(readLocalSystemStatusError({ code: 'unauthenticated' }).code, 'unauthenticated');
	assert.equal(readObservationError({ code: 'host_key_untrusted' }).code, 'host_key_untrusted');
	codecChecks.push('finite local failure', 'finite observation failure');
	const local = { cpuPercent: 0, memPercent: 0, memUsed: 0, memTotal: 100, uptimeSeconds: 1 };
	assert.equal(readLocalSystemStatus(local).diskUsed, undefined);
	codecChecks.push('missing disk is not zero');
	rejects(() => readLocalSystemStatus({ ...local, memUsed: -1 }), 'negative measurement');
	rejects(() => readLocalSystemStatus({ ...local, cpuModel: 'x'.repeat(16384) }), 'local budget');
	rejects(() => readSshResourceStatusList([{ key: 'host:22' }]), 'incomplete list item');
	const resource = {
		key: 'host:22',
		connectionId: 1,
		name: 'host',
		username: 'fixture',
		host: 'host',
		port: 22,
		checkedAt: 100,
		status: { timestamp: 100 },
	};
	rejects(() => readSshResourceStatusList([resource, resource]), 'duplicate host key');
	rejects(() => readSshResourceStatusList([{ ...resource, error: 'remote_unavailable' }]), 'mixed success and error');
	assert.equal(codecChecks.length, 18);
});
