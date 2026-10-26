import { sha256 } from '@noble/hashes/sha2.js';
import {
	readAgentArtifactBegin,
	readAgentArtifactAttach,
	readAgentArtifactAttachResponse,
	readAgentArtifactCleanup,
	readAgentArtifactCleanupResponse,
	readAgentArtifactCleanupResultResponse,
	readAgentArtifactDeleteResponse,
	readAgentArtifactEmptyRequest,
	readAgentArtifactListResponse,
	readAgentArtifactQuery,
	readAgentArtifactResponse,
	readAgentArtifactRetain,
	readAgentArtifactStorageResponse,
	readAgentArtifactUploadHeaders,
	readAgentArtifactVersion,
} from '@nexus-terminal/shared/agent/artifacts/http-codec';
import { readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import {
	AGENT_ARTIFACT_MAX_BODY_BYTES,
	AGENT_ARTIFACT_MAX_BYTES,
	AGENT_ARTIFACT_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/artifacts/values';
import type { AgentArtifactQuery } from '@nexus-terminal/shared/agent/artifacts/http';
import { requestBinary } from '@/client/http/binary-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import {
	fromArtifact,
	fromArtifactStorage,
	fromArtifactCleanup,
	fromArtifactCleanupResult,
	fromArtifactAttachment,
} from '../model/artifact-mapper';
import type {
	ManagedArtifact,
	ArtifactFilters,
	ArtifactPage,
	ArtifactStorage,
	ArtifactCleanupPlan,
	ArtifactCleanupResult,
	ArtifactAttachment,
	ArtifactAttachmentTarget,
} from '../model/artifact-types';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement, rejectAgentManagementResponse } from './management-request';

const budgets = { maxRequestBytes: AGENT_ARTIFACT_MAX_BODY_BYTES, maxResponseBytes: AGENT_ARTIFACT_MAX_RESPONSE_BYTES };

function artifactPath(appId: string, id?: string): string {
	try {
		const root = '/apps/' + encodeURIComponent(readAgentId(appId)) + '/artifacts';
		return id === undefined ? root : root + '/' + encodeURIComponent(readAgentId(id));
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

export async function listManagedArtifacts(
	filters: ArtifactFilters,
	offset: number,
	signal?: AbortSignal,
): Promise<ArtifactPage> {
	const params = new URLSearchParams({ q: filters.query, limit: '20', offset: String(offset) });
	if (filters.appId) {
		params.set('appId', filters.appId);
	}
	if (filters.kind) {
		params.set('kind', filters.kind);
	}
	if (filters.retention !== 'all') {
		params.set('retained', String(filters.retention === 'retained'));
	}
	let query: AgentArtifactQuery;
	try {
		query = readAgentArtifactQuery(params);
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	const path = filters.appId ? artifactPath(filters.appId) : '/files';
	const result = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: path + '?' + params,
		signal,

		decode(value) {
			const result = readAgentArtifactListResponse(value);
			if (
				result.items.length > query.limit ||
				result.items.some(
					(item) =>
						(query.appId !== null && item.appId !== query.appId) ||
						(query.kind !== null && item.kind !== query.kind) ||
						(query.retained !== null && item.retained !== query.retained),
				) ||
				(result.nextOffset !== null &&
					(result.nextOffset !== offset + query.limit || result.items.length !== query.limit))
			) {
				throw new Error('Artifact page does not match requested scope');
			}
			return result;
		},
	});
	return { items: result.items.map(fromArtifact), nextOffset: result.nextOffset };
}

export async function getArtifactStorage(signal?: AbortSignal): Promise<ArtifactStorage> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: '/files/storage',
		decode: readAgentArtifactStorageResponse,
		signal,
	});
	return fromArtifactStorage(value.storage);
}

export async function getManagedArtifact(appId: string, id: string, signal?: AbortSignal): Promise<ManagedArtifact> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: artifactPath(appId, id),
		signal,

		decode(value) {
			const item = readAgentArtifactResponse(value).artifact;
			if (item.id !== id || item.appId !== appId) {
				throw new Error('Artifact response belongs to another resource');
			}
			return item;
		},
	});
	return fromArtifact(value);
}

export async function beginManagedArtifact(appId: string, file: File, signal?: AbortSignal): Promise<ManagedArtifact> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: artifactPath(appId),
		expectedStatus: 201,
		signal,

		input: () =>
			readAgentArtifactBegin({
				name: file.name,
				mediaType: file.type || 'application/octet-stream',
				declaredBytes: file.size,
			}),

		decode(value) {
			const item = readAgentArtifactResponse(value).artifact;
			if (
				item.appId !== appId ||
				item.status !== 'staging' ||
				item.version !== 1 ||
				item.name !== file.name ||
				item.sizeBytes !== file.size ||
				item.mediaType !== (file.type || 'application/octet-stream')
			) {
				throw new Error('Artifact reservation confirmation mismatch');
			}
			return item;
		},
	});
	return fromArtifact(value);
}

async function artifactBinary(input: {
	method: 'GET' | 'PUT';
	path: string;
	body?: File;
	headers?: Record<string, string>;
	maxResponseBytes: number;
	signal?: AbortSignal;
}) {
	let response;
	try {
		response = await requestBinary({
			method: input.method,
			url: '/api/v1/agent' + input.path,
			body: input.body,
			headers: input.headers,
			maxRequestBytes: AGENT_ARTIFACT_MAX_BYTES,
			maxResponseBytes: input.maxResponseBytes,
			maxErrorBytes: AGENT_ARTIFACT_MAX_BODY_BYTES,
			timeoutMs: 75_000,
			signal: input.signal,
		});
	} catch (cause) {
		if (cause instanceof HttpRequestFailure) {
			throw new AgentManagementFailure(cause.code, cause.outcome, { cause });
		}
		throw new AgentManagementFailure('request_failed', 'unknown', { cause });
	}
	if (response.status >= 400) {
		const value = readJson(response.headers, response.bytes);
		rejectAgentManagementResponse(response.status, value);
	}
	return response;
}

function readJson(headers: Headers, bytes: Uint8Array): unknown {
	try {
		if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(headers.get('content-type') ?? '')) {
			throw new Error('Unexpected Artifact media type');
		}
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch (cause) {
		throw new AgentManagementFailure('protocol_failure', 'unknown', { cause });
	}
}

// A transfer batch, independent of the configured Artifact storage quota.
const ARTIFACT_TRANSFER_CHUNK_BYTES = 4 * 1024 * 1024;

async function hashFile(file: Blob, signal?: AbortSignal): Promise<string> {
	const hash = sha256.create();
	try {
		for (let offset = 0; offset < file.size; offset += ARTIFACT_TRANSFER_CHUNK_BYTES) {
			if (signal?.aborted) throw new AgentManagementFailure('cancelled', 'not_dispatched');
			const chunk = await file.slice(offset, offset + ARTIFACT_TRANSFER_CHUNK_BYTES).arrayBuffer();
			if (signal?.aborted) throw new AgentManagementFailure('cancelled', 'not_dispatched');
			hash.update(new Uint8Array(chunk));
		}
		return Array.from(hash.digest(), (value) => value.toString(16).padStart(2, '0')).join('');
	} finally {
		hash.destroy();
	}
}

export async function uploadManagedArtifact(
	original: ManagedArtifact,
	file: File,
	signal?: AbortSignal,
): Promise<ManagedArtifact> {
	let headers;
	try {
		if (original.status !== 'staging' || file.size !== original.sizeBytes || file.size > AGENT_ARTIFACT_MAX_BYTES) {
			throw new Error('Invalid Artifact upload');
		}
		headers = { 'If-Match': '"' + original.version + '"', 'Content-Type': 'application/octet-stream' };
		readAgentArtifactUploadHeaders(headers['If-Match'], headers['Content-Type']);
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	const hash = await hashFile(file, signal);
	const response = await artifactBinary({
		method: 'PUT',
		path: artifactPath(original.appId, original.id) + '/content',
		body: file,
		headers,
		maxResponseBytes: AGENT_ARTIFACT_MAX_RESPONSE_BYTES,
		signal,
	});
	try {
		const item = readAgentArtifactResponse(readJson(response.headers, response.bytes)).artifact;
		if (
			response.status !== 200 ||
			item.id !== original.id ||
			item.appId !== original.appId ||
			item.status !== 'ready' ||
			item.version <= original.version ||
			item.sizeBytes !== file.size ||
			item.sha256 !== hash ||
			item.name !== original.name ||
			item.mediaType !== original.mediaType
		) {
			throw new Error('Artifact upload confirmation mismatch');
		}
		return fromArtifact(item);
	} catch (cause) {
		throw new AgentManagementFailure('protocol_failure', 'unknown', { cause });
	}
}

export async function downloadManagedArtifact(original: ManagedArtifact, signal?: AbortSignal): Promise<Blob> {
	if (original.status !== 'ready' || original.sha256 === null) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched');
	}
	const chunks: Blob[] = [];
	const hash = sha256.create();
	try {
		let offset = 0;
		do {
			const end = Math.min(original.sizeBytes, offset + ARTIFACT_TRANSFER_CHUNK_BYTES);
			const partial = original.sizeBytes > ARTIFACT_TRANSFER_CHUNK_BYTES;
			const response = await artifactBinary({
				method: 'GET',
				path: artifactPath(original.appId, original.id) + '/content',
				headers: partial ? { Range: 'bytes=' + offset + '-' + (end - 1) } : undefined,
				maxResponseBytes: Math.max(1, end - offset),
				signal,
			});
			const declared = response.headers.get('content-length');
			if (
				response.status !== (partial ? 206 : 200) ||
				response.headers.get('content-type') !== 'application/octet-stream' ||
				response.headers.get('etag') !== '"' + original.version + '"' ||
				response.headers.get('content-range') !==
					(partial ? 'bytes ' + offset + '-' + (end - 1) + '/' + original.sizeBytes : null) ||
				response.bytes.byteLength !== end - offset ||
				(declared !== null && !response.headers.has('content-encoding') && declared !== String(end - offset))
			) {
				throw new Error('Artifact content confirmation mismatch');
			}
			if (signal?.aborted) throw new AgentManagementFailure('cancelled', 'unknown');
			hash.update(response.bytes);
			chunks.push(new Blob([response.bytes]));
			offset = end;
		} while (offset < original.sizeBytes);
		const digest = Array.from(hash.digest(), (value) => value.toString(16).padStart(2, '0')).join('');
		if (digest !== original.sha256) {
			throw new Error('Artifact hash confirmation mismatch');
		}
		return new Blob(chunks, { type: 'application/octet-stream' });
	} catch (cause) {
		if (cause instanceof AgentManagementFailure) {
			throw cause;
		}
		throw new AgentManagementFailure('protocol_failure', 'unknown', { cause });
	} finally {
		hash.destroy();
	}
}

export async function retainManagedArtifact(original: ManagedArtifact, signal?: AbortSignal): Promise<ManagedArtifact> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'PATCH',
		path: artifactPath(original.appId, original.id) + '/retain',
		signal,

		input: () => readAgentArtifactRetain({ expectedVersion: original.version, retained: !original.retained }),

		decode(value) {
			const item = readAgentArtifactResponse(value).artifact;
			if (
				item.id !== original.id ||
				item.appId !== original.appId ||
				item.version !== original.version + 1 ||
				item.retained !== !original.retained ||
				item.status !== 'ready'
			) {
				throw new Error('Artifact retention confirmation mismatch');
			}
			return item;
		},
	});
	return fromArtifact(value);
}

export async function deleteManagedArtifact(original: ManagedArtifact, signal?: AbortSignal): Promise<void> {
	await requestAgentManagement({
		...budgets,
		method: 'DELETE',
		path: artifactPath(original.appId, original.id),
		signal,

		input: () => readAgentArtifactVersion({ expectedVersion: original.version }),

		decode: readAgentArtifactDeleteResponse,
	});
}

async function previewArtifactCleanup(appId: string, signal?: AbortSignal): Promise<ArtifactCleanupPlan> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: artifactPath(appId) + '/cleanup/preview',
		signal,

		input() {
			readAgentArtifactEmptyRequest({});
			return {};
		},

		decode: readAgentArtifactCleanupResponse,
	});
	return fromArtifactCleanup(value.confirmation);
}

async function confirmArtifactCleanup(
	appId: string,
	plan: ArtifactCleanupPlan,
	signal?: AbortSignal,
): Promise<ArtifactCleanupResult> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: artifactPath(appId) + '/cleanup/confirm',
		signal,

		input: () => readAgentArtifactCleanup({ confirmationId: plan.id }),

		decode(value) {
			const result = readAgentArtifactCleanupResultResponse(value).result;
			if (
				result.deletedCount + result.failedCount + result.skippedCount > plan.selectedCount ||
				result.deletedBytes > plan.selectedBytes
			) {
				throw new Error('Artifact cleanup result exceeds confirmed plan');
			}
			return result;
		},
	});
	return fromArtifactCleanupResult(value);
}

export async function cleanupManagedArtifacts(appId: string, signal?: AbortSignal): Promise<ArtifactCleanupResult> {
	const plan = await previewArtifactCleanup(appId, signal);
	return confirmArtifactCleanup(appId, plan, signal);
}

export async function attachManagedArtifact(
	original: ManagedArtifact,
	target: ArtifactAttachmentTarget,
	signal?: AbortSignal,
): Promise<ArtifactAttachment> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: artifactPath(original.appId, original.id) + '/attachments',
		signal,

		input: () =>
			readAgentArtifactAttach({
				expectedVersion: original.version,
				targetAppId: target.appId,
				threadId: target.threadId,
				runId: target.runId,
			}),

		decode(value) {
			const attachment = readAgentArtifactAttachResponse(value).attachment;
			const artifact = attachment.artifact;
			if (
				artifact.id !== original.id ||
				artifact.appId !== original.appId ||
				artifact.version !== original.version + 1 ||
				artifact.status !== 'ready' ||
				attachment.targetAppId !== target.appId ||
				attachment.threadId !== target.threadId ||
				attachment.runId !== target.runId
			) {
				throw new Error('Artifact attachment confirmation mismatch');
			}
			return attachment;
		},
	});
	return fromArtifactAttachment(value);
}
