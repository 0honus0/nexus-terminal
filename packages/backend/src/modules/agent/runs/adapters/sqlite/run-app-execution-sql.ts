import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredParticipantScope } from '../../storage/run-collaboration-storage.js';
import type { StoredRunAppExecution } from '../../storage/run-storage.js';
import { appExecutionBinding } from '../../../plugins/adapters/sqlite/plugin-app-execution-sql.js';
import { readRunAppExecution } from './run-app-execution-row.js';

function samePackage(
	left: { packageId: string; version: string; packageHash: string; publisherKeyId: string },
	right: { packageId: string; version: string; packageHash: string; publisherKeyId: string },
): boolean {
	return (
		left.packageId === right.packageId &&
		left.version === right.version &&
		left.packageHash === right.packageHash &&
		left.publisherKeyId === right.publisherKeyId
	);
}

export function sameRunAppExecution(left: StoredRunAppExecution, right: StoredRunAppExecution): boolean {
	return (
		samePackage(left.package, right.package) &&
		left.handler === right.handler &&
		left.codeDependencies.length === right.codeDependencies.length &&
		left.codeDependencies.every((dependency) =>
			right.codeDependencies.some((other) => samePackage(dependency, other)),
		)
	);
}

export async function currentRunAppExecution(tx: SqlExecutor, scope: StoredParticipantScope): Promise<boolean> {
	const row = await tx.one(
		'SELECT i.app_execution_json FROM agent_runs r JOIN agent_run_inputs i ON i.run_id=r.id WHERE r.id=? AND r.user_id=? AND r.app_id=?',
		[scope.runId, scope.userId, scope.appId],
	);
	if (!row) {
		return false;
	}
	const frozen = readRunAppExecution(row.app_execution_json);
	const current = await appExecutionBinding(tx, scope.userId, scope.appId, true);
	return (
		current !== null &&
		sameRunAppExecution(frozen, {
			kind: 'plugin',
			package: {
				packageId: current.package.packageId,
				version: current.package.version,
				packageHash: current.package.packageHash,
				publisherKeyId: current.package.publisherKeyId,
			},
			codeDependencies: current.codeDependencies.map((dependency) => ({
				packageId: dependency.packageId,
				version: dependency.version,
				packageHash: dependency.packageHash,
				publisherKeyId: dependency.publisherKeyId,
			})),
			handler: current.handler,
		})
	);
}
