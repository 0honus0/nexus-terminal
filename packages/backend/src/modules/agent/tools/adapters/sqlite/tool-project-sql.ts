import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	ToolProjectStorage,
	StoredProjectScope,
	StoredProjectBinding,
	StoredProjectMutation,
} from '../../storage/tool-project-storage.js';
import { toolOperation } from '../../../runs/adapters/sqlite/run-tool-row.js';
import { currentParticipant, storedInteger, storedText } from '../../../runs/adapters/sqlite/run-participant-sql.js';

export class SqliteToolProjectStorage implements ToolProjectStorage {
	constructor(private readonly db: SqliteRuntime) {}

	get(scope: StoredProjectScope): Promise<StoredProjectBinding | null> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				'SELECT p.directory,p.target_version,p.fingerprint FROM agent_run_projects p JOIN agent_runs r ON r.id=p.run_id WHERE r.id=? AND r.user_id=? AND r.app_id=? AND p.connection_id=?',
				[scope.runId, scope.userId, scope.appId, scope.connectionId],
			);
			if (!row) {
				return null;
			}
			const directory = storedText(row.directory);
			const fingerprint = storedText(row.fingerprint);
			if (
				Buffer.byteLength(directory, 'utf8') > 256 ||
				!directory.startsWith('/') ||
				directory.split('/').includes('..') ||
				!fingerprint ||
				fingerprint.length > 128
			) {
				throw new Error('Corrupt project binding');
			}
			return { directory, targetVersion: storedInteger(row.target_version, 1), fingerprint };
		});
	}

	change(command: StoredProjectMutation): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const { scope } = command;
			const operation = await toolOperation(tx, scope.userId, scope.appId, scope.runId, command.operationId);
			const policy = await tx.one(
				'SELECT policy_revision FROM agent_governance_policies WHERE user_id=? AND app_id=?',
				[scope.userId, scope.appId],
			);
			if (
				!operation ||
				operation.state !== 'dispatched' ||
				operation.operationHash !== command.operationHash ||
				operation.targetId !== scope.connectionId ||
				operation.toolName !==
					(command.binding === null ? 'project_directory_clear' : 'project_directory_bind') ||
				!policy ||
				policy.policy_revision !== command.policyRevision ||
				!(await currentParticipant(tx, scope, Date.now, operation.toolName, operation.modelStepIndex))
			) {
				return false;
			}
			if (
				await tx.one('SELECT operation_id FROM agent_project_effects WHERE operation_id=?', [
					command.operationId,
				])
			) {
				return false;
			}
			if (command.binding) {
				const target = await tx.one('SELECT version,type FROM connections WHERE id=?', [scope.connectionId]);
				if (
					!target ||
					target.type !== 'SSH' ||
					target.version !== command.binding.targetVersion ||
					operation.targetVersion !== command.binding.targetVersion
				) {
					return false;
				}
				await tx.run(
					'INSERT INTO agent_run_projects(run_id,connection_id,directory,target_version,fingerprint) VALUES(?,?,?,?,?) ON CONFLICT(run_id,connection_id) DO UPDATE SET directory=excluded.directory,target_version=excluded.target_version,fingerprint=excluded.fingerprint',
					[
						scope.runId,
						scope.connectionId,
						command.binding.directory,
						command.binding.targetVersion,
						command.binding.fingerprint,
					],
				);
			} else {
				await tx.run('DELETE FROM agent_run_projects WHERE run_id=? AND connection_id=?', [
					scope.runId,
					scope.connectionId,
				]);
			}
			await tx.run('INSERT INTO agent_project_effects(operation_id) VALUES(?)', [command.operationId]);
			return true;
		});
	}
}
