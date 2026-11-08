import { openAgentExecution } from '../../backend/agent/runs/support/agent-execution-fixture.mjs';
import { openImageFixture } from '../../backend/agent/runs/support/agent-image-fixture.mjs';
import { openSshd } from '../protocols/openssh-fixture.mjs';
import { pauseToolResults } from './invocation-barriers.mjs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

export { until as waitForHost } from '../protocols/openssh-fixture.mjs';

export { HOST_HARNESS_API_VERSION } from './artifact-contract.mjs';

/** Image Provider protocol peer uses the same exact signed-package installation path. */
export function openImageHost(directory, { packages, packageId, selectedRootIds, uiPackageId }) {
	return openImageFixture(directory, {
		plugin: { signedPackages: packages, packageId, selectedRootIds, uiPackageId },
	});
}

/** Test-artifact entry point; plugin tests consume this instead of Host implementation modules. */
export async function openAgentHost(
	directory,
	{ packages, packageId, selectedRootIds, uiPackageId, protocol, contextWindow, discover },
) {
	const sshd = await openSshd(directory);
	let host;
	try {
		host = await openAgentExecution(directory, sshd, {
			protocol,
			contextWindow,
			discover,
			plugin: { signedPackages: packages, packageId, selectedRootIds, uiPackageId },
		});
	} catch (error) {
		try {
			await sshd.close();
		} catch (cleanup) {
			throw new AggregateError([error, cleanup], 'Host startup and SSH close failed');
		}
		throw error;
	}
	let closing;
	const barriers = [];
	// Read-only evidence belongs to this Host artifact; plugins never query Host tables.
	host.runPolicyEvidence = (run) => {
		const [row] = host.rows('agent_runs', run);
		assert.ok(row);
		return { deadlineAt: row.deadline_at };
	};
	host.childPolicyEvidence = (run) => {
		const [row] = host.rows('agent_run_children', run);
		assert.ok(row);
		return { maxModelRequests: row.max_requests, toolKeys: JSON.parse(row.tools_json) };
	};
	host.operationAuthorityEvidence = (operationId) => {
		const database = new DatabaseSync(host.database, { readOnly: true });
		try {
			const row = database
				.prepare('SELECT proof_json FROM agent_operation_authorities WHERE operation_id=?')
				.get(operationId);
			assert.ok(row);
			const proof = JSON.parse(row.proof_json);
			return { packageId: proof.instance.packageId, instanceId: proof.instance.id };
		} finally {
			database.close();
		}
	};
	host.pauseToolResults = (paths, options) => {
		const barrier = pauseToolResults(host.appId, paths, options);
		barriers.push(barrier);
		return barrier;
	};
	const closeHost = host.close;
	host.close = (options) => {
		closing ??= Promise.resolve().then(async () => {
			const failures = [];
			for (const close of [
				...barriers.map((barrier) => () => barrier.close()),
				() => closeHost(options),
				() => sshd.close(),
			]) {
				try {
					await close();
				} catch (error) {
					failures.push(error);
				}
			}
			if (failures.length === 1) {
				throw failures[0];
			}
			if (failures.length > 1) {
				throw new AggregateError(failures, 'Host and SSH close failed');
			}
		});
		return closing;
	};
	return host;
}
