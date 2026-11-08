import assert from 'node:assert/strict';
import { listAgentApprovalHistory } from './agent-approval-fixture.mjs';
import { until, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

/** Configure a real logical provider through the Host-owned connection and secret boundary. */
export async function configureProtocol(f, packageId, connector, credential = { action: 'clear' }) {
	const base = '/api/v1/agent/plugins/apps/' + f.appId + '/instances';
	const instance = expectStatus(await f.api('GET', base), 200).instances.find((item) => item.packageId === packageId);
	assert.ok(instance, 'Expected selected protocol provider: ' + packageId);
	const path = base + '/' + instance.id + '/connection';
	const before = expectStatus(await f.api('GET', path), 200);
	const updated = expectStatus(
		await f.api('PUT', path, {
			expectedRevision: before.revision,
			connector,
			credential,
		}),
		200,
	);
	assert.equal(updated.hasCredential, credential.action === 'replace');
	if (credential.action === 'replace') {
		assert.ok(!JSON.stringify(updated).includes(credential.value));
	}
	return { instance, connection: updated };
}

/** Advance transport gates only; each scenario controls its inner permission decision. */
export async function nextProtocolPermission(f, run) {
	return until(
		async () => {
			const approvals = await listAgentApprovalHistory(f.api, f.appId, run.id);
			for (const item of approvals.filter((approval) => approval.status === 'requested')) {
				if (item.operationName === 'transport.permission') return item;
				assert.ok(
					['transport.session', 'transport.stdio.write'].includes(item.operationName),
					item.operationName,
				);
				await f.approve(item);
			}
			const current = expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + run.id), 200);
			assert.ok(
				!['failed', 'unknown', 'cancelled', 'completed'].includes(current.status),
				JSON.stringify(current),
			);
			return null;
		},
		(value) => value !== null,
		'Independent protocol permission',
	);
}

export async function completeProtocol(f, run) {
	const approved = [];
	const final = await until(
		async () => {
			for (const item of await listAgentApprovalHistory(f.api, f.appId, run.id)) {
				if (item.status !== 'requested') continue;
				assert.ok(
					['transport.session', 'transport.stdio.write'].includes(item.operationName),
					item.operationName,
				);
				await f.approve(item);
				approved.push(item);
			}
			return expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + run.id), 200);
		},
		(value) => ['completed', 'failed', 'unknown', 'cancelled'].includes(value.status),
		'Protocol completion',
	);
	assert.equal(final.status, 'completed', JSON.stringify(final));
	return approved;
}
