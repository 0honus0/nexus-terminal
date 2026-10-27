import {
	AGENT_ARTIFACT_STATUSES,
	AGENT_ARTIFACT_CONTENT_TYPES,
	AGENT_ARTIFACT_MAX_BYTES,
} from '@nexus-terminal/shared/agent/artifacts/values';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import type { StoredArtifact } from '../../storage/artifact-storage.js';

export function artifactInteger(value: unknown, min = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt artifact integer');
	}
	return value;
}

function id(value: unknown): string {
	if (typeof value !== 'string' || !AGENT_ID_PATTERN.test(value)) {
		throw new Error('Corrupt artifact identity');
	}
	return value;
}

function text(value: unknown, max: number): string {
	if (
		typeof value !== 'string' ||
		!value ||
		Buffer.byteLength(value, 'utf8') > max ||
		Buffer.from(value, 'utf8').toString('utf8') !== value
	) {
		throw new Error('Corrupt artifact text');
	}
	return value;
}

export function artifactRow(row: Record<string, unknown>): StoredArtifact {
	const status = AGENT_ARTIFACT_STATUSES.find((v) => v === row.status);
	const kind = AGENT_ARTIFACT_CONTENT_TYPES.find((v) => v === row.kind);
	const sha256 = row.sha256 === null ? null : text(row.sha256, 64);
	const createdAt = artifactInteger(row.created_at);
	const readyAt = row.ready_at === null ? null : artifactInteger(row.ready_at, createdAt);
	const deletedAt = row.deleted_at === null ? null : artifactInteger(row.deleted_at, readyAt ?? createdAt);
	const name = text(row.name, 256);
	const mediaType = text(row.media_type, 128);
	const sizeBytes = artifactInteger(row.size_bytes);
	if (
		!status ||
		!kind ||
		!name.trim() ||
		/[\u0000-\u001f\u007f/\\]/u.test(name) ||
		!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mediaType) ||
		(row.upload_claimed !== 0 && row.upload_claimed !== 1) ||
		sizeBytes > AGENT_ARTIFACT_MAX_BYTES ||
		(sha256 !== null && !/^[a-f0-9]{64}$/u.test(sha256)) ||
		(row.retained !== 0 && row.retained !== 1) ||
		(status === 'ready' && (readyAt === null || sha256 === null)) ||
		(status === 'staging' && (readyAt !== null || sha256 !== null)) ||
		(status === 'deleted' && deletedAt === null) ||
		(status !== 'deleted' && deletedAt !== null)
	) {
		throw new Error('Corrupt artifact record');
	}
	return {
		id: id(row.id),
		appId: id(row.app_id),
		name,
		mediaType,
		kind,
		sizeBytes,
		sha256,
		status,
		retained: row.retained === 1,
		version: artifactInteger(row.version, 1),
		createdAt,
		readyAt,
		expiresAt: row.expires_at === null ? null : artifactInteger(row.expires_at, 1),
		deletedAt,
	};
}
