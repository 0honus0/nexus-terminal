import {
	readMutationQuery,
	readMutationId,
	readMutationList,
	readMutationClaim,
	readMutationEvidence,
	readMutationRelease,
	readMutationFailure,
} from '@nexus-terminal/shared/remote/mutations/http-codec';
import {
	MUTATION_BODY_MAX_BYTES,
	MUTATION_RESPONSE_MAX_BYTES,
	type MutationErrorCode,
} from '@nexus-terminal/shared/remote/mutations/values';
import { requestJson, type JsonRequest } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { structurallyEqual } from '@/foundation/data';
import { fromMutation } from '../model/mutation-mapper';
import {
	MutationRequestFailure,
	type MutationClaim,
	type MutationPage,
	type EvidenceInput,
} from '../model/mutation-types';

const statuses: Record<MutationErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	version_conflict: 409,
	resource_active: 409,
	limit_exceeded: 413,
	storage_unavailable: 503,
	operation_unknown: 500,
	shutting_down: 503,
};

function validate<T>(read: () => T): T {
	try {
		return read();
	} catch (cause) {
		throw new MutationRequestFailure('invalid_input', 'not_dispatched', { cause });
	}
}

async function request<T>(
	method: JsonRequest['method'],
	path: string,
	decode: (raw: unknown) => T,
	body?: unknown,
	signal?: AbortSignal,
): Promise<T> {
	try {
		const response = await requestJson({
			method,
			url: '/api/v1/remote/mutations' + path,
			body,
			maxRequestBytes: MUTATION_BODY_MAX_BYTES,
			maxResponseBytes: MUTATION_RESPONSE_MAX_BYTES,
			signal,
		});
		if (response.status >= 400) {
			const { code } = readMutationFailure(response.body);
			if (response.status !== statuses[code]) {
				throw new MutationRequestFailure('protocol_failure', 'unknown');
			}
			throw new MutationRequestFailure(
				code,
				code === 'operation_unknown' || code === 'storage_unavailable' ? 'unknown' : 'confirmed',
			);
		}
		if (response.status !== 200) {
			throw new MutationRequestFailure('protocol_failure', 'unknown');
		}
		return decode(response.body);
	} catch (cause) {
		if (cause instanceof MutationRequestFailure) {
			throw cause;
		}
		if (cause instanceof HttpRequestFailure) {
			throw new MutationRequestFailure(cause.code, cause.outcome, { cause });
		}
		throw new MutationRequestFailure('protocol_failure', 'unknown', { cause });
	}
}

function correlated(raw: unknown, original: MutationClaim): MutationClaim {
	const value = readMutationClaim(raw);
	if (
		value.id !== original.id ||
		value.origin !== original.origin ||
		value.createdAt !== original.createdAt ||
		value.blockedAt !== original.blockedAt ||
		value.revision !== original.revision + 1 ||
		!structurallyEqual(value.targets, original.targets) ||
		!structurallyEqual(value.evidence.slice(0, original.evidence.length), original.evidence)
	) {
		throw new Error('Unrelated mutation result');
	}
	return fromMutation(value);
}

export const mutationApi = {
	async list(after: string | null, signal?: AbortSignal): Promise<MutationPage> {
		const query = new URLSearchParams({ limit: '20' });
		if (after !== null) {
			query.set('after', after);
		}
		const input = validate(() => readMutationQuery(query));
		return request(
			'GET',
			'?' + query,
			(raw) => {
				const value = readMutationList(raw, input);
				return { items: value.items.map(fromMutation), nextCursor: value.nextCursor };
			},
			undefined,
			signal,
		);
	},

	async get(id: string, signal?: AbortSignal): Promise<MutationClaim> {
		const key = validate(() => readMutationId(id));
		return request(
			'GET',
			'/' + encodeURIComponent(key),
			(raw) => {
				const value = readMutationClaim(raw);
				if (value.id !== key) {
					throw new Error('Unrelated mutation detail');
				}
				return fromMutation(value);
			},
			undefined,
			signal,
		);
	},

	async evidence(original: MutationClaim, input: EvidenceInput, signal?: AbortSignal): Promise<MutationClaim> {
		const id = validate(() => readMutationId(original.id));
		const command = validate(() =>
			readMutationEvidence({
				expectedRevision: input.expectedRevision,
				outcome: input.outcome,
				resourcesStopped: input.resourcesStopped,
				producerStopped: input.producerStopped,
				observedAt: input.observedAt,
				note: input.note,
			}),
		);
		if (command.expectedRevision !== original.revision) {
			throw new MutationRequestFailure('invalid_input', 'not_dispatched');
		}
		return request(
			'POST',
			'/' + encodeURIComponent(id) + '/evidence',
			(raw) => {
				const value = correlated(raw, original);
				const evidence = value.evidence.at(-1);
				if (
					value.state !== 'blocked' ||
					value.evidence.length !== original.evidence.length + 1 ||
					!evidence ||
					evidence.claimRevision !== original.revision ||
					evidence.outcome !== command.outcome ||
					evidence.observedAt !== command.observedAt ||
					evidence.note !== command.note
				) {
					throw new Error('Unrelated mutation evidence');
				}
				return value;
			},
			command,
			signal,
		);
	},

	async release(original: MutationClaim, evidenceId: string, signal?: AbortSignal): Promise<MutationClaim> {
		const id = validate(() => readMutationId(original.id));
		const command = validate(() =>
			readMutationRelease({ expectedRevision: original.revision, evidenceId, confirmed: true }),
		);
		return request(
			'POST',
			'/' + encodeURIComponent(id) + '/release',
			(raw) => {
				const value = correlated(raw, original);
				if (
					value.state !== 'released' ||
					value.recoveryAllowed ||
					value.evidence.length !== original.evidence.length
				) {
					throw new Error('Unrelated mutation release');
				}
				return value;
			},
			command,
			signal,
		);
	},
};
