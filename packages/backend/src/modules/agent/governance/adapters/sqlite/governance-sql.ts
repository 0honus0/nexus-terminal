import { executionSettings } from '../../../execution/adapters/sqlite/execution-sql.js';
import type { StoredExecutionSettings } from '../../../execution/storage/execution-storage.js';
import { readRunSelection } from '../../../runs/adapters/sqlite/run-selection.js';
import { assertPendingApprovalRevisions, supersedePendingApprovals } from './policy-write.js';

import { appAuthority } from '../../../scope/adapters/sqlite/app-row.js';
import { currentDenylist, replaceTargetDenylist } from './denylist-sql.js';
import type {
	StoredDenylistCommand,
	StoredTargetDenylist,
	StoredDenylistMutation,
} from '../../storage/governance-storage.js';

import type { SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import { AGENT_CAPABILITIES } from '@nexus-terminal/shared/agent/governance/values';
import type {
	GovernanceStorage,
	StoredToolCatalogFacts,
	StoredPolicyOverrides,
	StoredPolicy,
	StoredGrant,
	GrantReplaceResult,
	ExecutionReplaceResult,
} from '../../storage/governance-storage.js';
import { integer, readPolicy, scopeJson, readRunStatus, assertRevisionAvailable } from './governance-row.js';

export async function currentPolicy(tx: SqlReader, userId: number, appId: string): Promise<StoredPolicy | null> {
	const app = await appAuthority(tx, userId, appId);
	if (app === null) {
		return null;
	}
	const header = await tx.one(
		'SELECT policy_revision,execution_version,execution_overrides_json FROM agent_governance_policies WHERE user_id=? AND app_id=?',
		[userId, appId],
	);
	if (header === null) {
		throw new Error('Missing App governance policy');
	}
	const grants = await tx.all(
		'SELECT capability,schema_version,scope_json,granted_at FROM agent_governance_grants WHERE user_id=? AND app_id=? ORDER BY capability LIMIT ?',
		[userId, appId, AGENT_CAPABILITIES.length + 1],
	);
	if (grants.length > AGENT_CAPABILITIES.length) {
		throw new Error('Corrupt Agent grant capacity');
	}
	const denylist = await currentDenylist(tx);
	return readPolicy(userId, appId, header, grants, {
		enabled: app.enabled,
		declared: app.declared,
		capabilities: app.capabilities.map((capability) => capability),
		deniedTargetIds: denylist.entries.map((entry) => entry.connectionId),
	});
}

export class SqliteGovernanceStorage implements GovernanceStorage {
	constructor(private readonly db: SqliteRuntime) {}

	denylist(): Promise<StoredTargetDenylist> {
		return this.db.transaction(currentDenylist);
	}

	replaceDenylist(
		input: StoredDenylistCommand,
		now: () => number,
		decide: (current: StoredTargetDenylist) => { revoke: boolean },
	): Promise<StoredDenylistMutation | 'version_conflict' | 'not_found'> {
		return this.db.transaction((tx) => replaceTargetDenylist(tx, input, now, decide));
	}

	execution(
		userId: number,
		appId: string,
	): Promise<{ policy: StoredPolicy; settings: StoredExecutionSettings | null } | null> {
		return this.db.transaction(async (tx) => {
			const policy = await currentPolicy(tx, userId, appId);
			return policy === null ? null : { policy, settings: await executionSettings(tx, userId) };
		});
	}

	toolCatalog(userId: number, appId: string, runId: string): Promise<StoredToolCatalogFacts | null> {
		return this.db.transaction(async (tx) => {
			const policy = await currentPolicy(tx, userId, appId);
			const run = await tx.one(
				'SELECT status,selected_connections_json FROM agent_runs WHERE id=? AND user_id=? AND app_id=?',
				[runId, userId, appId],
			);
			if (policy === null || run === null) {
				return null;
			}
			const status = readRunStatus(run.status);
			// The first catalog is read before reserving the model step transitions pending to running.
			if (status !== 'pending' && status !== 'running') {
				return null;
			}
			const selected = readRunSelection(run.selected_connections_json);
			const targets = await tx.all(
				"SELECT id FROM connections WHERE type='SSH' AND id IN (SELECT value FROM json_each(?)) ORDER BY id",
				[JSON.stringify(selected)],
			);
			const denylist = await currentDenylist(tx);
			return {
				policy,
				connectionIds: targets.map((target) => integer(target.id, 1)),
				denylistRevision: denylist.revision,
			};
		});
	}

	policy(userId: number, appId: string): Promise<StoredPolicy | null> {
		return this.db.transaction((tx) => currentPolicy(tx, userId, appId));
	}

	async replaceGrants(
		userId: number,
		appId: string,
		expectedRevision: number,
		grants: StoredGrant[],
		decide: (current: StoredPolicy) => { allow: boolean; pendingStatus: 'superseded' | null },
	): Promise<GrantReplaceResult> {
		return this.db.transaction(async (tx) => {
			const current = await currentPolicy(tx, userId, appId);
			if (!current) {
				return { status: 'not_found' };
			}
			if (current.revision !== expectedRevision) {
				return { status: 'version_conflict' };
			}
			const decision = decide(current);
			if (!decision.allow) {
				return { status: 'version_conflict' };
			}
			assertRevisionAvailable(current.revision);
			if (decision.pendingStatus !== null) {
				await assertPendingApprovalRevisions(tx, userId, appId);
			}
			const cas = await tx.run(
				'UPDATE agent_governance_policies SET policy_revision=policy_revision+1 WHERE user_id=? AND app_id=? AND policy_revision=?',
				[userId, appId, expectedRevision],
			);
			if (cas.changes !== 1) {
				return { status: 'version_conflict' };
			}
			await tx.run('DELETE FROM agent_governance_grants WHERE user_id=? AND app_id=?', [userId, appId]);
			for (const grant of grants) {
				await tx.run(
					`INSERT INTO agent_governance_grants
    (user_id,app_id,capability,schema_version,scope_json,granted_at) VALUES(?,?,?,?,?,?)`,
					[userId, appId, grant.capability, grant.schemaVersion, scopeJson(grant.scope), grant.grantedAt],
				);
			}
			if (decision.pendingStatus !== null) {
				await supersedePendingApprovals(tx, userId, appId);
			}
			const updated = await currentPolicy(tx, userId, appId);
			if (!updated) {
				throw new Error('Governance policy disappeared');
			}
			return { status: 'ok', policy: updated };
		});
	}

	async replaceExecution(
		userId: number,
		appId: string,
		version: number,
		overrides: StoredPolicyOverrides,
		decide: (
			current: StoredPolicy,
			settings: StoredExecutionSettings | null,
		) => { allow: boolean; pendingStatus: 'superseded' | null },
	): Promise<ExecutionReplaceResult> {
		return this.db.transaction(async (tx) => {
			const current = await currentPolicy(tx, userId, appId);
			if (!current) {
				return { status: 'not_found' };
			}
			if (current.executionVersion !== version) {
				return { status: 'version_conflict' };
			}
			const settings = await executionSettings(tx, userId);
			const decision = decide(current, settings);
			if (!decision.allow) {
				return { status: 'version_conflict' };
			}
			assertRevisionAvailable(current.revision);
			assertRevisionAvailable(current.executionVersion);
			if (decision.pendingStatus !== null) {
				await assertPendingApprovalRevisions(tx, userId, appId);
			}
			const updated = await tx.run(
				`UPDATE agent_governance_policies
    SET execution_version=execution_version+1,execution_overrides_json=?,policy_revision=policy_revision+1
    WHERE user_id=? AND app_id=? AND execution_version=?`,
				[JSON.stringify(overrides), userId, appId, version],
			);
			if (updated.changes !== 1) {
				return { status: 'version_conflict' };
			}
			if (decision.pendingStatus !== null) {
				await supersedePendingApprovals(tx, userId, appId);
			}
			const policy = await currentPolicy(tx, userId, appId);
			if (!policy) {
				throw new Error('Governance policy disappeared');
			}
			return { status: 'ok', policy, settings };
		});
	}
}
