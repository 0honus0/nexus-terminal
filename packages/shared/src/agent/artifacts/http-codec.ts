import { AGENT_ARTIFACT_MAX_CLEANUP_ITEMS } from './values.js';
import { agentRecord, agentText, agentInteger, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import {
	AGENT_ARTIFACT_STATUSES,
	AGENT_ARTIFACT_CONTENT_TYPES,
	AGENT_ARTIFACT_MAX_BYTES,
	AGENT_ARTIFACT_MAX_PAGE,
	AGENT_ARTIFACT_MAX_RESPONSE_BYTES,
} from './values.js';
import type {
	AgentArtifactView,
	AgentArtifactStorageView,
	AgentArtifactCleanupView,
	AgentArtifactCleanupResult,
	AgentArtifactAttachmentView,
} from './model.js';
import type {
	AgentArtifactBeginRequest,
	AgentArtifactVersionRequest,
	AgentArtifactRetainRequest,
	AgentArtifactAttachRequest,
	AgentArtifactQuery,
	AgentArtifactCleanupRequest,
	AgentArtifactResponse,
	AgentArtifactListResponse,
	AgentArtifactStorageResponse,
	AgentArtifactCleanupResponse,
	AgentArtifactCleanupResultResponse,
	AgentArtifactAttachResponse,
} from './http.js';

function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return value;
}

function time(value: unknown): number | null {
	return value === null ? null : agentInteger(value);
}

export function readAgentArtifactBegin(value: unknown): AgentArtifactBeginRequest {
	const r = agentRecord(value, ['name', 'mediaType', 'declaredBytes']);
	const name = agentText(r.name, 256);
	const mediaType = agentText(r.mediaType, 128);
	if (
		!name.trim() ||
		/[\u0000-\u001f\u007f/\\]/u.test(name) ||
		!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mediaType)
	) {
		throw new InvalidAgentPayload();
	}
	return { name, mediaType, declaredBytes: agentInteger(r.declaredBytes, 0, AGENT_ARTIFACT_MAX_BYTES) };
}

export function readAgentArtifactVersion(value: unknown): AgentArtifactVersionRequest {
	return { expectedVersion: agentInteger(agentRecord(value, ['expectedVersion']).expectedVersion, 1) };
}

export function readAgentArtifactRetain(value: unknown): AgentArtifactRetainRequest {
	const r = agentRecord(value, ['expectedVersion', 'retained']);
	return { expectedVersion: agentInteger(r.expectedVersion, 1), retained: boolean(r.retained) };
}

export function readAgentArtifactAttach(value: unknown): AgentArtifactAttachRequest {
	const r = agentRecord(value, ['expectedVersion', 'targetAppId', 'threadId', 'runId']);
	return {
		expectedVersion: agentInteger(r.expectedVersion, 1),
		targetAppId: readAgentId(r.targetAppId),
		threadId: readAgentId(r.threadId),
		runId: r.runId === null ? null : readAgentId(r.runId),
	};
}

export function readAgentArtifactCleanup(value: unknown): AgentArtifactCleanupRequest {
	return { confirmationId: readAgentId(agentRecord(value, ['confirmationId']).confirmationId) };
}

export function readAgentArtifactQuery(query: URLSearchParams): AgentArtifactQuery {
	const keys = ['appId', 'retained', 'kind', 'q', 'offset', 'limit'];
	if ([...query.keys()].some((k) => !keys.includes(k)) || keys.some((k) => query.getAll(k).length > 1)) {
		throw new InvalidAgentPayload();
	}
	const retained = query.get('retained');
	if (retained !== null && retained !== 'true' && retained !== 'false') {
		throw new InvalidAgentPayload();
	}
	const kindText = query.get('kind');
	const kind = kindText === null ? null : AGENT_ARTIFACT_CONTENT_TYPES.find((v) => v === kindText);
	if (kind === undefined) {
		throw new InvalidAgentPayload();
	}

	function number(key: string, fallback: number, min: number, max: number): number {
		const raw = query.get(key);
		if (raw === null) {
			return fallback;
		}
		if (!/^(0|[1-9][0-9]{0,8})$/u.test(raw)) {
			throw new InvalidAgentPayload();
		}
		return agentInteger(Number(raw), min, max);
	}

	const app = query.get('appId');
	return {
		appId: app === null ? null : readAgentId(app),
		retained: retained === null ? null : retained === 'true',
		kind,
		q: query.get('q') === null || query.get('q') === '' ? '' : agentText(query.get('q'), 256),
		offset: number('offset', 0, 0, 10000),
		limit: number('limit', 20, 1, AGENT_ARTIFACT_MAX_PAGE),
	};
}

export function readAgentArtifactView(value: unknown): AgentArtifactView {
	const r = agentRecord(value, [
		'id',
		'appId',
		'name',
		'mediaType',
		'kind',
		'sizeBytes',
		'sha256',
		'status',
		'retained',
		'version',
		'createdAt',
		'readyAt',
		'expiresAt',
		'deletedAt',
	]);
	const status = AGENT_ARTIFACT_STATUSES.find((v) => v === r.status);
	const kind = AGENT_ARTIFACT_CONTENT_TYPES.find((v) => v === r.kind);
	if (
		!status ||
		!kind ||
		(r.sha256 !== null && (typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(r.sha256)))
	) {
		throw new InvalidAgentPayload();
	}
	const createdAt = agentInteger(r.createdAt);
	const readyAt = time(r.readyAt);
	const deletedAt = time(r.deletedAt);
	if (
		(readyAt !== null && readyAt < createdAt) ||
		(deletedAt !== null && deletedAt < createdAt) ||
		(status === 'ready' && (r.sha256 === null || readyAt === null)) ||
		(status === 'deleted' && deletedAt === null) ||
		(status !== 'deleted' && deletedAt !== null) ||
		(status === 'staging' && (r.sha256 !== null || readyAt !== null))
	) {
		throw new InvalidAgentPayload();
	}
	const sha256 = typeof r.sha256 === 'string' ? r.sha256 : null;
	return {
		id: readAgentId(r.id),
		appId: readAgentId(r.appId),
		name: agentText(r.name, 256),
		mediaType: agentText(r.mediaType, 128),
		kind,
		sizeBytes: agentInteger(r.sizeBytes, 0, AGENT_ARTIFACT_MAX_BYTES),
		sha256,
		status,
		retained: boolean(r.retained),
		version: agentInteger(r.version, 1),
		createdAt,
		readyAt,
		expiresAt: time(r.expiresAt),
		deletedAt,
	};
}

export function readAgentArtifactResponse(value: unknown): AgentArtifactResponse {
	return { artifact: readAgentArtifactView(agentRecord(value, ['artifact']).artifact) };
}

export function readAgentArtifactListResponse(value: unknown): AgentArtifactListResponse {
	const r = agentRecord(value, ['items', 'nextOffset'], AGENT_ARTIFACT_MAX_RESPONSE_BYTES);
	if (!Array.isArray(r.items) || r.items.length > AGENT_ARTIFACT_MAX_PAGE) {
		throw new InvalidAgentPayload();
	}
	const items = r.items.map((v: unknown) => readAgentArtifactView(v));
	if (new Set(items.map((v) => v.id)).size !== items.length) {
		throw new InvalidAgentPayload();
	}
	return { items, nextOffset: r.nextOffset === null ? null : agentInteger(r.nextOffset, 1, 10000) };
}

export function readAgentArtifactStorage(value: unknown): AgentArtifactStorageView {
	const r = agentRecord(value, [
		'totalBytes',
		'retainedBytes',
		'protectedBytes',
		'reclaimableBytes',
		'stagingBytes',
		'unavailableBytes',
		'reservedBytes',
		'limitBytes',
	]);
	return {
		totalBytes: agentInteger(r.totalBytes),
		retainedBytes: agentInteger(r.retainedBytes),
		protectedBytes: agentInteger(r.protectedBytes),
		reclaimableBytes: agentInteger(r.reclaimableBytes),
		stagingBytes: agentInteger(r.stagingBytes),
		unavailableBytes: agentInteger(r.unavailableBytes),
		reservedBytes: agentInteger(r.reservedBytes),
		limitBytes: agentInteger(r.limitBytes, 1),
	};
}

export function readAgentArtifactStorageResponse(value: unknown): AgentArtifactStorageResponse {
	return {
		storage: readAgentArtifactStorage(agentRecord(value, ['storage'], AGENT_ARTIFACT_MAX_RESPONSE_BYTES).storage),
	};
}

export function readAgentArtifactCleanupResponse(value: unknown): AgentArtifactCleanupResponse {
	return {
		confirmation: readAgentArtifactCleanupView(
			agentRecord(value, ['confirmation'], AGENT_ARTIFACT_MAX_RESPONSE_BYTES).confirmation,
		),
	};
}

export function readAgentArtifactCleanupResultResponse(value: unknown): AgentArtifactCleanupResultResponse {
	return {
		result: readAgentArtifactCleanupResult(
			agentRecord(value, ['result'], AGENT_ARTIFACT_MAX_RESPONSE_BYTES).result,
		),
	};
}

export function readAgentArtifactCleanupView(value: unknown): AgentArtifactCleanupView {
	const r = agentRecord(value, [
		'confirmationId',
		'expiresAt',
		'selectedCount',
		'selectedBytes',
		'protectedCount',
		'byApp',
	]);
	if (!Array.isArray(r.byApp) || r.byApp.length > AGENT_ARTIFACT_MAX_CLEANUP_ITEMS) {
		throw new InvalidAgentPayload();
	}
	const byApp = r.byApp.map((v: unknown) => {
		const row = agentRecord(v, ['appId', 'count', 'bytes']);
		return {
			appId: readAgentId(row.appId),
			count: agentInteger(row.count, 1, AGENT_ARTIFACT_MAX_CLEANUP_ITEMS),
			bytes: agentInteger(row.bytes),
		};
	});
	const selectedCount = agentInteger(r.selectedCount, 0, AGENT_ARTIFACT_MAX_CLEANUP_ITEMS);
	const selectedBytes = agentInteger(r.selectedBytes);
	if (
		new Set(byApp.map((v) => v.appId)).size !== byApp.length ||
		byApp.reduce((sum, v) => sum + v.count, 0) !== selectedCount ||
		byApp.reduce((sum, v) => sum + v.bytes, 0) !== selectedBytes
	) {
		throw new InvalidAgentPayload();
	}
	return {
		confirmationId: readAgentId(r.confirmationId),
		expiresAt: agentInteger(r.expiresAt, 1),
		selectedCount,
		selectedBytes,
		protectedCount: agentInteger(r.protectedCount),
		byApp,
	};
}

export function readAgentArtifactCleanupResult(value: unknown): AgentArtifactCleanupResult {
	const r = agentRecord(value, ['deletedCount', 'deletedBytes', 'skippedCount', 'failedCount', 'partial']);
	const failedCount = agentInteger(r.failedCount, 0, AGENT_ARTIFACT_MAX_CLEANUP_ITEMS);
	const skippedCount = agentInteger(r.skippedCount, 0, AGENT_ARTIFACT_MAX_CLEANUP_ITEMS);
	const partial = boolean(r.partial);
	if (partial !== (failedCount > 0 || skippedCount > 0)) {
		throw new InvalidAgentPayload();
	}
	return {
		deletedCount: agentInteger(r.deletedCount, 0, AGENT_ARTIFACT_MAX_CLEANUP_ITEMS),
		deletedBytes: agentInteger(r.deletedBytes),
		skippedCount,
		failedCount,
		partial,
	};
}

export function readAgentArtifactAttachment(value: unknown): AgentArtifactAttachmentView {
	const r = agentRecord(value, ['artifact', 'sourceAppId', 'targetAppId', 'threadId', 'runId', 'role', 'crossApp']);
	const artifact = readAgentArtifactView(r.artifact);
	const sourceAppId = readAgentId(r.sourceAppId);
	const targetAppId = readAgentId(r.targetAppId);
	const crossApp = boolean(r.crossApp);
	if (r.role !== 'input' || artifact.appId !== sourceAppId || crossApp !== (sourceAppId !== targetAppId)) {
		throw new InvalidAgentPayload();
	}
	return {
		artifact,
		sourceAppId,
		targetAppId,
		threadId: readAgentId(r.threadId),
		runId: r.runId === null ? null : readAgentId(r.runId),
		role: 'input',
		crossApp,
	};
}

export function readAgentArtifactAttachResponse(value: unknown): AgentArtifactAttachResponse {
	return { attachment: readAgentArtifactAttachment(agentRecord(value, ['attachment']).attachment) };
}

export function readAgentArtifactUploadHeaders(ifMatch: unknown, contentType: unknown): { expectedVersion: number } {
	if (
		typeof ifMatch !== 'string' ||
		!/^"[1-9][0-9]{0,14}"$/u.test(ifMatch) ||
		contentType !== 'application/octet-stream'
	) {
		throw new InvalidAgentPayload();
	}
	return { expectedVersion: agentInteger(Number(ifMatch.slice(1, -1)), 1) };
}

export function readAgentArtifactDownloadRange(
	value: unknown,
	sizeBytes: number,
): import('./http.js').AgentArtifactDownloadRange {
	agentInteger(sizeBytes, 0, AGENT_ARTIFACT_MAX_BYTES);
	if (value === undefined) {
		return { start: 0, endInclusive: sizeBytes - 1, partial: false };
	}
	if (typeof value !== 'string' || !/^bytes=[0-9]{1,15}-[0-9]{0,15}$/u.test(value) || sizeBytes === 0) {
		throw new InvalidAgentPayload();
	}
	const parts = value.slice(6).split('-');
	const start = agentInteger(Number(parts[0]), 0, sizeBytes - 1);
	const endInclusive = parts[1] === '' ? sizeBytes - 1 : agentInteger(Number(parts[1]), start, sizeBytes - 1);
	return { start, endInclusive, partial: true };
}

export function readAgentArtifactEmptyRequest(value: unknown): void {
	agentRecord(value, []);
}

export function readAgentArtifactDeleteResponse(value: unknown): import('./http.js').AgentArtifactDeleteResponse {
	if (agentRecord(value, ['deleted']).deleted !== true) {
		throw new InvalidAgentPayload();
	}
	return { deleted: true };
}
