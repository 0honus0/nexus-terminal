import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredOperation, StoredOperationDispatchAuthority } from '../../storage/operation-storage.js';

/** Compare the trusted policy decision's mutable facts in the transaction that consumes approval and records dispatch. */
export async function currentDispatchAuthority(
	tx: SqlExecutor,
	operation: StoredOperation,
	proof: StoredOperationDispatchAuthority,
	now: number,
	mode: 'dispatch' | 'verify' = 'dispatch',
): Promise<boolean> {
	const scope = operation.scope;
	const current = await tx.one(
		`SELECT p.policy_revision FROM agent_governance_policies p
	 JOIN agent_apps a ON a.user_id=p.user_id AND a.id=p.app_id
	 JOIN agent_execution_settings s ON s.user_id=p.user_id
	 JOIN agent_target_denylist_meta d ON d.id=1
	 WHERE p.user_id=? AND p.app_id=? AND p.policy_revision=? AND p.execution_version=?
	 AND a.enabled=1 AND s.version=? AND json_extract(s.settings_json,'$.enabled')=1 AND d.revision=?`,
		[
			scope.userId,
			scope.appId,
			proof.policyRevision,
			proof.policyExecutionVersion,
			proof.settingsVersion,
			proof.denylistRevision,
		],
	);
	if (!current) {
		return false;
	}
	for (const participant of [proof.instance, ...proof.ancestors]) {
		const active = await tx.one(
			`SELECT i.instance_id FROM agent_plugin_runtime_instances i
		 JOIN agent_plugin_instances logical ON logical.user_id=i.user_id AND logical.app_id=i.app_id AND logical.id=i.logical_instance_id
		 JOIN agent_plugin_packages p ON p.user_id=i.user_id AND p.package_id=i.package_id
		 JOIN agent_plugin_app_packages ref ON ref.user_id=p.user_id AND ref.app_id=i.app_id AND ref.package_id=p.package_id
		 AND ref.version=p.version AND ref.package_hash=p.package_hash AND ref.publisher_key_id=p.publisher_key_id
		 JOIN agent_plugin_publishers k ON k.user_id=p.user_id AND k.key_id=p.publisher_key_id
		 WHERE i.user_id=? AND i.app_id=? AND i.logical_instance_id=? AND i.package_id=? AND i.generation=?
		 AND i.revision=? AND i.configuration_revision=? AND i.state='active' AND logical.enabled=1
		 AND logical.configuration_revision=i.configuration_revision AND p.status='installed' AND p.revision=i.revision AND k.revoked_at IS NULL`,
			[
				scope.userId,
				scope.appId,
				participant.id,
				participant.packageId,
				participant.generation,
				participant.packageRevision,
				participant.configurationRevision,
			],
		);
		if (!active) {
			return false;
		}
	}
	if (proof.provider) {
		const provider = await tx.one(
			`SELECT id FROM agent_providers WHERE id=? AND user_id=? AND version=?
		 AND credential_revision=? AND enabled=1 AND deleted_at IS NULL`,
			[proof.provider.id, scope.userId, proof.provider.version, proof.provider.credentialRevision],
		);
		if (!provider) {
			return false;
		}
	}
	if (proof.target) {
		const target = await tx.one(
			`SELECT id FROM connections WHERE id=? AND version=? AND type='SSH'
		 AND NOT EXISTS(SELECT 1 FROM agent_target_denylist WHERE connection_id=connections.id)`,
			[proof.target.id, proof.target.version],
		);
		if (!target) {
			return false;
		}
	}
	if (proof.approval) {
		if (mode === 'verify') {
			const consumed = await tx.one(
				`SELECT id FROM agent_operation_approvals WHERE id=? AND operation_id=?
			 AND status='approved' AND consumed_at IS NOT NULL AND version=? AND operation_hash=? AND policy_revision=?`,
				[
					proof.approval.id,
					operation.id,
					proof.approval.version + 1,
					operation.requestHash,
					proof.policyRevision,
				],
			);
			return consumed !== null;
		}
		const consumed = await tx.run(
			`UPDATE agent_operation_approvals SET consumed_at=?,version=version+1
		 WHERE id=? AND operation_id=? AND version=? AND status='approved' AND consumed_at IS NULL
		 AND expires_at>? AND operation_hash=? AND policy_revision=? AND version<?`,
			[
				now,
				proof.approval.id,
				operation.id,
				proof.approval.version,
				now,
				operation.requestHash,
				proof.policyRevision,
				Number.MAX_SAFE_INTEGER,
			],
		);
		if (consumed.changes !== 1) {
			return false;
		}
	}
	return true;
}
