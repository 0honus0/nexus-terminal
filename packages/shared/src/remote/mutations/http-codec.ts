import { record, integer, text, uuid, InvalidPayload } from '../../common/http-codec.js';
import type { MutationClaimView, MutationEvidenceView } from './model.js';
import type {
	MutationEvidenceRequest,
	MutationReleaseRequest,
	MutationListQuery,
	MutationListResponse,
} from './http.js';
import {
	MUTATION_STATES,
	MUTATION_ORIGINS,
	MUTATION_OUTCOMES,
	MUTATION_ERROR_CODES,
	MUTATION_ID_MAX_BYTES,
	MUTATION_NOTE_MAX_BYTES,
	MUTATION_BODY_MAX_BYTES,
	MUTATION_RESPONSE_MAX_BYTES,
	MUTATION_PAGE_MAX_ITEMS,
	MUTATION_MAX_EVIDENCE,
} from './values.js';

function choice<T extends string>(value: unknown, values: readonly T[]): T {
	const found = values.find((item) => item === value);
	if (found === undefined) {
		throw new InvalidPayload();
	}
	return found;
}

export function readMutationId(value: unknown): string {
	const id = text(value, MUTATION_ID_MAX_BYTES);
	if (!/^[A-Za-z0-9_.:-]+$/u.test(id)) {
		throw new InvalidPayload();
	}
	return id;
}

export function readMutationEvidence(value: unknown): MutationEvidenceRequest {
	const v = record(
		value,
		['expectedRevision', 'outcome', 'resourcesStopped', 'producerStopped', 'observedAt', 'note'],
		MUTATION_BODY_MAX_BYTES,
	);
	if (v.resourcesStopped !== true || v.producerStopped !== true) {
		throw new InvalidPayload();
	}
	return {
		expectedRevision: integer(v.expectedRevision, 1, Number.MAX_SAFE_INTEGER - 1),
		outcome: choice(v.outcome, MUTATION_OUTCOMES),
		resourcesStopped: true,
		producerStopped: true,
		observedAt: integer(v.observedAt),
		note: text(v.note, MUTATION_NOTE_MAX_BYTES),
	};
}

export function readMutationRelease(value: unknown): MutationReleaseRequest {
	const v = record(value, ['expectedRevision', 'evidenceId', 'confirmed'], MUTATION_BODY_MAX_BYTES);
	if (v.confirmed !== true) {
		throw new InvalidPayload();
	}
	return {
		expectedRevision: integer(v.expectedRevision, 1, Number.MAX_SAFE_INTEGER - 1),
		evidenceId: uuid(v.evidenceId),
		confirmed: true,
	};
}

export function readMutationQuery(query: URLSearchParams): MutationListQuery {
	if (
		[...query.keys()].some((key) => !['after', 'limit'].includes(key)) ||
		query.getAll('after').length > 1 ||
		query.getAll('limit').length > 1
	) {
		throw new InvalidPayload();
	}
	const raw = query.get('limit');
	if (raw !== null && !/^[1-9][0-9]?$/u.test(raw)) {
		throw new InvalidPayload();
	}
	return {
		after: query.has('after') ? readMutationId(query.get('after')) : null,
		limit: raw === null ? 20 : integer(Number(raw), 1, MUTATION_PAGE_MAX_ITEMS),
	};
}

function timestamp(value: unknown): number | null {
	return value === null ? null : integer(value);
}

function evidence(value: unknown): MutationEvidenceView {
	const v = record(
		value,
		[
			'id',
			'claimRevision',
			'source',
			'outcome',
			'resourcesStopped',
			'producerStopped',
			'observedAt',
			'note',
			'recordedBy',
			'createdAt',
		],
		MUTATION_RESPONSE_MAX_BYTES,
	);
	if (v.source !== 'administrator' || v.resourcesStopped !== true || v.producerStopped !== true) {
		throw new InvalidPayload();
	}
	return {
		id: uuid(v.id),
		claimRevision: integer(v.claimRevision, 1),
		source: 'administrator',
		outcome: choice(v.outcome, MUTATION_OUTCOMES),
		resourcesStopped: true,
		producerStopped: true,
		observedAt: integer(v.observedAt),
		note: text(v.note, MUTATION_NOTE_MAX_BYTES),
		recordedBy: integer(v.recordedBy, 1),
		createdAt: integer(v.createdAt),
	};
}

export function readMutationClaim(value: unknown): MutationClaimView {
	const v = record(
		value,
		[
			'id',
			'origin',
			'state',
			'revision',
			'createdAt',
			'blockedAt',
			'releasedAt',
			'targets',
			'recoveryAllowed',
			'evidence',
		],
		MUTATION_RESPONSE_MAX_BYTES,
	);
	if (
		!Array.isArray(v.targets) ||
		!v.targets.length ||
		v.targets.length > 2 ||
		!Array.isArray(v.evidence) ||
		v.evidence.length > MUTATION_MAX_EVIDENCE ||
		typeof v.recoveryAllowed !== 'boolean'
	) {
		throw new InvalidPayload();
	}
	const state = choice(v.state, MUTATION_STATES);
	const blockedAt = timestamp(v.blockedAt),
		releasedAt = timestamp(v.releasedAt),
		createdAt = integer(v.createdAt);
	if (
		(state === 'held' && (blockedAt !== null || releasedAt !== null)) ||
		(state === 'blocked' && (blockedAt === null || releasedAt !== null)) ||
		(state === 'released' && (blockedAt === null || releasedAt === null)) ||
		(v.recoveryAllowed && state !== 'blocked')
	) {
		throw new InvalidPayload();
	}
	const revision = integer(v.revision, 1);
	const items = v.evidence.map(evidence);
	if (
		revision !== (state === 'held' ? 1 : 2 + items.length + (state === 'released' ? 1 : 0)) ||
		(state === 'held' && items.length) ||
		(state === 'released' && !items.length) ||
		(blockedAt !== null && blockedAt < createdAt) ||
		(releasedAt !== null && blockedAt !== null && releasedAt < blockedAt)
	) {
		throw new InvalidPayload();
	}
	if (
		new Set(items.map((item) => item.id)).size !== items.length ||
		items.some(
			(item, index) =>
				item.claimRevision >= revision ||
				item.claimRevision !== index + 2 ||
				item.observedAt < (blockedAt ?? createdAt) ||
				item.observedAt > item.createdAt ||
				(releasedAt !== null && item.createdAt > releasedAt) ||
				(index > 0 && item.claimRevision <= items[index - 1].claimRevision),
		)
	) {
		throw new InvalidPayload();
	}
	return {
		id: readMutationId(v.id),
		origin: choice(v.origin, MUTATION_ORIGINS),
		state,
		revision,
		createdAt,
		blockedAt,
		releasedAt,
		recoveryAllowed: v.recoveryAllowed,
		evidence: items,
		targets: v.targets.map((raw) => {
			const target = record(raw, ['targetId', 'fingerprint']);
			const fingerprint = text(target.fingerprint, 64);
			if (!/^[a-f0-9]{64}$/u.test(fingerprint)) {
				throw new InvalidPayload();
			}
			return { targetId: integer(target.targetId, 1), fingerprint };
		}),
	};
}

export function readMutationList(value: unknown, query: MutationListQuery): MutationListResponse {
	const v = record(value, ['items', 'nextCursor'], MUTATION_RESPONSE_MAX_BYTES);
	if (!Array.isArray(v.items) || v.items.length > query.limit) {
		throw new InvalidPayload();
	}
	const items = v.items.map(readMutationClaim);
	if (items.some((item, index) => item.id <= (index ? items[index - 1].id : (query.after ?? '')))) {
		throw new InvalidPayload();
	}
	const cursor = v.nextCursor === null ? null : readMutationId(v.nextCursor);
	if (cursor !== null && (!items.length || items.length !== query.limit || cursor !== items[items.length - 1].id)) {
		throw new InvalidPayload();
	}
	return { items, nextCursor: cursor };
}

export function readMutationFailure(value: unknown): { code: import('./values.js').MutationErrorCode } {
	const v = record(value, ['code'], MUTATION_BODY_MAX_BYTES);
	return { code: choice(v.code, MUTATION_ERROR_CODES) };
}
