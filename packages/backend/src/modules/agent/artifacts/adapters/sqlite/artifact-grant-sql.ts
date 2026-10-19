import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredArtifact } from '../../storage/artifact-storage.js';
import { ArtifactStorageRefusal } from '../../storage/artifact-storage.js';
import { artifactRow } from './artifact-row.js';

/** Transaction-bound tasks owned by Artifact; callers retain all application policy. */
export async function readGrantedArtifactSource(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	id: string,
): Promise<StoredArtifact> {
	const row = await tx.one('SELECT * FROM agent_artifacts WHERE user_id=? AND app_id=? AND id=?', [
		userId,
		appId,
		id,
	]);
	if (!row) {
		throw new ArtifactStorageRefusal('not_found');
	}
	return artifactRow(row);
}

export async function publishArtifactGrants(
	tx: SqlExecutor,
	userId: number,
	receiptId: string,
	receiverAppId: string,
	artifacts: StoredArtifact[],
	expiresAt: number,
): Promise<void> {
	for (const item of artifacts) {
		await tx.run(
			'INSERT INTO agent_artifact_grants(receipt_id,artifact_id,user_id,receiver_app_id,artifact_version,expires_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)',
			[receiptId, item.id, userId, receiverAppId, item.version, expiresAt],
		);
	}
}

export async function revokeArtifactGrants(
	tx: SqlExecutor,
	userId: number,
	receiptId: string,
	now: number,
): Promise<void> {
	await tx.run(
		'UPDATE agent_artifact_grants SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=? AND receipt_id=?',
		[now, userId, receiptId],
	);
}

export async function readGrantedArtifact(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	receiptId: string,
	artifactId: string,
	now: number,
): Promise<StoredArtifact> {
	const row = await tx.one(
		`SELECT f.* FROM agent_artifact_grants g JOIN agent_artifacts f ON f.id=g.artifact_id
		WHERE g.user_id=? AND g.receiver_app_id=? AND g.receipt_id=? AND g.artifact_id=? AND g.revoked_at IS NULL AND g.expires_at>?
		AND f.user_id=g.user_id AND f.version=g.artifact_version`,
		[userId, appId, receiptId, artifactId, now],
	);
	if (!row) {
		throw new ArtifactStorageRefusal('not_found');
	}
	return artifactRow(row);
}
