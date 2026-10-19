import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredMutationObservation, StoredMutationEvidence } from '../../storage/mutation-storage.js';
import {
	MUTATION_STATES,
	MUTATION_ORIGINS,
	MUTATION_OUTCOMES,
	MUTATION_MAX_EVIDENCE,
	MUTATION_NOTE_MAX_BYTES,
} from '@nexus-terminal/shared/remote/mutations/values';

function integer(value: unknown, min = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt mutation integer');
	}
	return value;
}

function text(value: unknown, maxBytes: number): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		Buffer.byteLength(value) > maxBytes ||
		Buffer.from(value).toString('utf8') !== value
	) {
		throw new Error('Corrupt mutation text');
	}
	return value;
}

function choice<T extends string>(value: unknown, values: readonly T[]): T {
	const result = values.find((item) => item === value);
	if (result === undefined) {
		throw new Error('Corrupt mutation choice');
	}
	return result;
}

function identifier(value: unknown, uuid: boolean): string {
	const result = text(value, uuid ? 36 : 128);
	const valid = uuid
		? /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(result)
		: /^[A-Za-z0-9_.:-]+$/u.test(result);
	if (!valid) {
		throw new Error('Corrupt mutation identifier');
	}
	return result;
}

export function mutationEvidenceRow(row: SqlRow): StoredMutationEvidence {
	return {
		id: identifier(row.id, true),
		claimRevision: integer(row.claim_revision, 1),
		outcome: choice(row.outcome, MUTATION_OUTCOMES),
		observedAt: integer(row.observed_at),
		note: text(row.note, MUTATION_NOTE_MAX_BYTES),
		recordedBy: integer(row.recorded_by, 1),
		createdAt: integer(row.created_at),
	};
}

export function mutationRow(
	row: SqlRow,
	evidence: StoredMutationEvidence[],
	locks: readonly SqlRow[],
): StoredMutationObservation {
	const targets: unknown = JSON.parse(text(row.targets_json, 1024));
	if (!Array.isArray(targets) || !targets.length || targets.length > 2 || evidence.length > MUTATION_MAX_EVIDENCE) {
		throw new Error('Corrupt mutation collections');
	}
	const state = choice(row.state, MUTATION_STATES);
	const blockedAt = row.blocked_at === null ? null : integer(row.blocked_at);
	const releasedAt = row.released_at === null ? null : integer(row.released_at);
	const createdAt = integer(row.created_at),
		revision = integer(row.revision, 1);
	if (
		(row.resource_count !== 1 && row.resource_count !== 2) ||
		locks.length !== (state === 'released' ? 0 : row.resource_count) ||
		locks.some(
			(lock) =>
				lock.state !== state ||
				lock.created_at !== createdAt ||
				typeof lock.resource_key !== 'string' ||
				!/^[a-f0-9]{64}$/u.test(lock.resource_key),
		)
	) {
		throw new Error('Corrupt mutation resource set');
	}
	if (
		revision !== (state === 'held' ? 1 : 2 + evidence.length + (state === 'released' ? 1 : 0)) ||
		(state === 'held' && (blockedAt !== null || releasedAt !== null || evidence.length)) ||
		(state !== 'held' && blockedAt === null) ||
		(state === 'blocked' && releasedAt !== null) ||
		(state === 'released' && (releasedAt === null || !evidence.length)) ||
		(blockedAt !== null && blockedAt < createdAt) ||
		(releasedAt !== null && blockedAt !== null && releasedAt < blockedAt) ||
		evidence.some(
			(item, index) =>
				item.claimRevision >= revision ||
				item.claimRevision !== index + 2 ||
				item.observedAt < (blockedAt ?? createdAt) ||
				item.observedAt > item.createdAt ||
				(releasedAt !== null && item.createdAt > releasedAt) ||
				(index > 0 && item.claimRevision <= evidence[index - 1].claimRevision),
		)
	) {
		throw new Error('Corrupt mutation state');
	}
	return {
		id: identifier(row.id, false),
		origin: choice(row.origin, MUTATION_ORIGINS),
		ownerId: identifier(row.owner_id, true),
		state,
		revision,
		createdAt,
		blockedAt,
		releasedAt,
		evidence: evidence.map((value) => ({
			id: value.id,
			claimRevision: value.claimRevision,
			outcome: value.outcome,
			observedAt: value.observedAt,
			note: value.note,
			recordedBy: value.recordedBy,
			createdAt: value.createdAt,
		})),
		targets: targets.map((item: unknown) => {
			if (
				item === null ||
				typeof item !== 'object' ||
				Array.isArray(item) ||
				!('targetId' in item) ||
				!('fingerprint' in item) ||
				Object.keys(item).some((key) => key !== 'targetId' && key !== 'fingerprint')
			) {
				throw new Error('Corrupt mutation target');
			}
			const fingerprint = text(item.fingerprint, 64);
			if (!/^[a-f0-9]{64}$/u.test(fingerprint)) {
				throw new Error('Corrupt mutation target fingerprint');
			}
			return { targetId: integer(item.targetId, 1), fingerprint };
		}),
	};
}
