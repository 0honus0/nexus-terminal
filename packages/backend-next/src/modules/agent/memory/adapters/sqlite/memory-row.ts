import {
	AGENT_MEMORY_STATUSES,
	AGENT_MEMORY_DECISIONS,
	AGENT_MEMORY_MAX_CONTENT_BYTES,
} from '@nexus-terminal/shared/agent/memory/values';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import type { StoredMemory, StoredMemoryImport } from '../../storage/memory-storage.js';

export function memoryInteger(value: unknown, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Corrupt memory integer');
	}
	return value;
}

export function memoryId(value: unknown): string {
	if (typeof value !== 'string' || !AGENT_ID_PATTERN.test(value)) {
		throw new Error('Corrupt memory identity');
	}
	return value;
}

export function memoryRow(row: Record<string, unknown>): StoredMemory {
	const status = AGENT_MEMORY_STATUSES.find((value) => value === row.status);
	const action =
		row.review_action === null ? null : AGENT_MEMORY_DECISIONS.find((value) => value === row.review_action);
	const createdAt = memoryInteger(row.created_at);
	const updatedAt = memoryInteger(row.updated_at, createdAt);
	const reviewedAt = row.reviewed_at === null ? null : memoryInteger(row.reviewed_at, createdAt);
	if (
		!status ||
		action === undefined ||
		typeof row.content !== 'string' ||
		!row.content ||
		Buffer.from(row.content, 'utf8').toString('utf8') !== row.content ||
		Buffer.byteLength(row.content, 'utf8') > AGENT_MEMORY_MAX_CONTENT_BYTES ||
		typeof row.confidence !== 'number' ||
		!Number.isFinite(row.confidence) ||
		row.confidence < 0 ||
		row.confidence > 1 ||
		(status === 'candidate' && (action !== null || reviewedAt !== null)) ||
		(status === 'published' && (action !== 'publish' || reviewedAt === null)) ||
		(status === 'revoked' && ((action !== 'reject' && action !== 'revoke') || reviewedAt === null)) ||
		(reviewedAt !== null && reviewedAt > updatedAt)
	) {
		throw new Error('Corrupt memory record');
	}
	return {
		id: memoryId(row.id),
		appId: memoryId(row.app_id),
		content: row.content,
		confidence: row.confidence,
		status,
		sourceRunId: row.source_run_id === null ? null : memoryId(row.source_run_id),
		expiresAt: row.expires_at === null ? null : memoryInteger(row.expires_at, 1),
		reviewAction: action,
		reviewedAt,
		version: memoryInteger(row.version, 1),
		createdAt,
		updatedAt,
	};
}

export function memoryImportRow(row: Record<string, unknown>): StoredMemoryImport {
	return {
		id: memoryId(row.id),
		memoryId: memoryId(row.memory_id),
		sourceAppId: memoryId(row.source_app_id),
		sourceMemoryId: memoryId(row.source_memory_id),
		sourceVersion: memoryInteger(row.source_version, 1),
		expiresAt: memoryInteger(row.expires_at, 1),
	};
}
