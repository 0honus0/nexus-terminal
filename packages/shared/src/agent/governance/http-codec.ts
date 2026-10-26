import {
	AGENT_DENYLIST_MAX_TARGETS,
	AGENT_DENYLIST_MAX_REASON_BYTES,
	AGENT_DENYLIST_MAX_REASON_CODE_POINTS,
} from './values.js';
import type { AgentTargetDenylistView } from './model.js';
import type { AgentTargetDenylistReplaceRequest } from './http.js';
import {
	agentInteger,
	agentRecord,
	agentText,
	InvalidAgentPayload,
	isAgentRecord,
	readAgentId,
	encodeAgentJson,
} from '../http-codec.js';
import {
	AGENT_CAPABILITIES,
	AGENT_TARGET_CAPABILITIES,
	AGENT_GRANT_MAX_ID_BYTES,
	AGENT_GRANT_MAX_TARGET_IDS,
	AGENT_GOVERNANCE_MAX_BODY_BYTES,
	AGENT_GOVERNANCE_MAX_GRANT_BODY_BYTES,
	AGENT_EXECUTION_INTEGER_KEYS,
	AGENT_EXECUTION_COMPACTION_MODES,
	AGENT_EXECUTION_CONTEXT_PROFILES,
	AGENT_GOVERNANCE_MAX_RESPONSE_BYTES,
	AGENT_APPROVAL_STATUSES,
	AGENT_APPROVAL_KINDS,
	AGENT_APPROVAL_DECISIONS,
	AGENT_APPROVAL_RISKS,
	AGENT_APPROVAL_OPERATION_HASH_PATTERN,
	AGENT_APPROVAL_MAX_TOOL_NAME_BYTES,
	AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES,
	AGENT_APPROVAL_MAX_SUMMARY_BYTES,
	AGENT_APPROVAL_MAX_FEEDBACK_BYTES,
	AGENT_APPROVAL_OPERATION_HASH_LENGTH,
	AGENT_APPROVAL_MAX_PAGE_ITEMS,
} from './values.js';
import type { AgentCapability } from './values.js';
import type { AgentGrantScope, AgentExecutionPolicyOverrides } from './model.js';
import type {
	AgentGrantView,
	AgentExecutionPolicyView,
	AgentApprovalView,
	AgentApprovalPage,
	AgentCapabilityDefinition,
} from './model.js';
import type {
	AgentGovernanceAppPath,
	AgentApprovalPath,
	AgentRunApprovalsPath,
	AgentApprovalCommandHeaders,
	AgentGrantReplaceRequest,
	AgentExecutionPolicyReplaceRequest,
	AgentApprovalResolveRequest,
} from './http.js';

function record(input: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
	if (
		!isAgentRecord(input) ||
		Object.keys(input).some((key) => !keys.includes(key)) ||
		required.some((key) => !Object.hasOwn(input, key))
	) {
		throw new InvalidAgentPayload();
	}
	return input;
}

export function readAgentGovernanceAppPath(params: Record<string, string>): AgentGovernanceAppPath {
	return { appId: readAgentId(params.appId) };
}

export function readAgentApprovalPath(params: Record<string, string>): AgentApprovalPath {
	return { appId: readAgentId(params.appId), approvalId: readAgentId(params.approvalId) };
}

export function readAgentRunApprovalsPath(params: Record<string, string>): AgentRunApprovalsPath {
	return { appId: readAgentId(params.appId), runId: readAgentId(params.runId) };
}

function grantScope(value: unknown, capability: AgentCapability): AgentGrantScope {
	if (!isAgentRecord(value)) {
		throw new InvalidAgentPayload();
	}
	if (value.kind === 'global' && !AGENT_TARGET_CAPABILITIES.includes(capability)) {
		record(value, ['kind']);
		return { kind: 'global' };
	}
	if (value.kind !== 'targets' || !AGENT_TARGET_CAPABILITIES.includes(capability)) {
		throw new InvalidAgentPayload();
	}
	const raw = record(value, ['kind', 'targets']);
	const targets = record(raw.targets, ['ssh'], []);
	if (targets.ssh === undefined) {
		return { kind: 'targets', targets: {} };
	}
	const selection = record(targets.ssh, ['mode', 'ids'], ['mode']);
	if (selection.mode === 'all') {
		record(targets.ssh, ['mode']);
		return { kind: 'targets', targets: { ssh: { mode: 'all' } } };
	}
	if (
		selection.mode !== 'ids' ||
		!Array.isArray(selection.ids) ||
		selection.ids.length > AGENT_GRANT_MAX_TARGET_IDS
	) {
		throw new InvalidAgentPayload();
	}
	record(targets.ssh, ['mode', 'ids']);
	const ids = selection.ids.map((id) => agentText(id, AGENT_GRANT_MAX_ID_BYTES));
	if (
		new Set(ids).size !== ids.length ||
		ids.some((id) => !/^[1-9][0-9]*$/u.test(id) || !Number.isSafeInteger(Number(id)))
	) {
		throw new InvalidAgentPayload();
	}
	return { kind: 'targets', targets: { ssh: { mode: 'ids', ids: ids.sort() } } };
}

export function readAgentGrantReplaceRequest(value: unknown): AgentGrantReplaceRequest {
	encodeAgentJson(value, AGENT_GOVERNANCE_MAX_GRANT_BODY_BYTES);
	const row = agentRecord(value, ['grants', 'expectedPolicyRevision'], AGENT_GOVERNANCE_MAX_GRANT_BODY_BYTES);
	if (!Array.isArray(row.grants) || row.grants.length > AGENT_CAPABILITIES.length) {
		throw new InvalidAgentPayload();
	}
	const grants = row.grants.map((raw) => {
		const entry = record(raw, ['capability', 'scope']);
		const capability = AGENT_CAPABILITIES.find((c) => c === entry.capability);
		if (!capability) {
			throw new InvalidAgentPayload();
		}
		return { capability, scope: grantScope(entry.scope, capability) };
	});
	if (new Set(grants.map((g) => g.capability)).size !== grants.length) {
		throw new InvalidAgentPayload();
	}
	return { grants, expectedPolicyRevision: agentInteger(row.expectedPolicyRevision, 0) };
}

export function readAgentExecutionPolicyReplaceRequest(value: unknown): AgentExecutionPolicyReplaceRequest {
	encodeAgentJson(value, AGENT_GOVERNANCE_MAX_BODY_BYTES);
	const row = agentRecord(value, ['overrides', 'expectedVersion'], AGENT_GOVERNANCE_MAX_BODY_BYTES);
	return { expectedVersion: agentInteger(row.expectedVersion, 0), overrides: readPolicyOverrides(row.overrides) };
}

function readPolicyOverrides(value: unknown): AgentExecutionPolicyOverrides {
	const raw = record(value, [...AGENT_EXECUTION_INTEGER_KEYS, 'contextCompactionMode', 'contextProfile'], []);
	const overrides: AgentExecutionPolicyOverrides = {};
	for (const key of AGENT_EXECUTION_INTEGER_KEYS) {
		if (Object.hasOwn(raw, key)) {
			overrides[key] = agentInteger(raw[key], 1);
		}
	}
	if (Object.hasOwn(raw, 'contextCompactionMode')) {
		const match = AGENT_EXECUTION_COMPACTION_MODES.find((v) => v === raw.contextCompactionMode);
		if (!match) {
			throw new InvalidAgentPayload();
		}
		overrides.contextCompactionMode = match;
	}
	if (Object.hasOwn(raw, 'contextProfile')) {
		const match = AGENT_EXECUTION_CONTEXT_PROFILES.find((v) => v === raw.contextProfile);
		if (!match) {
			throw new InvalidAgentPayload();
		}
		overrides.contextProfile = match;
	}
	return overrides;
}

export function readAgentApprovalResolveRequest(value: unknown): AgentApprovalResolveRequest {
	encodeAgentJson(value, AGENT_GOVERNANCE_MAX_BODY_BYTES);
	const row = record(
		value,
		['decision', 'operationHash', 'expectedVersion', 'feedback'],
		['decision', 'operationHash', 'expectedVersion'],
	);
	const decision = AGENT_APPROVAL_DECISIONS.find((item) => item === row.decision);
	if (decision === undefined) {
		throw new InvalidAgentPayload();
	}
	const hash = agentText(row.operationHash, AGENT_APPROVAL_OPERATION_HASH_LENGTH);
	if (!AGENT_APPROVAL_OPERATION_HASH_PATTERN.test(hash)) {
		throw new InvalidAgentPayload();
	}
	const feedback = Object.hasOwn(row, 'feedback')
		? agentText(row.feedback, AGENT_APPROVAL_MAX_FEEDBACK_BYTES)
		: undefined;
	const result: AgentApprovalResolveRequest = {
		decision,
		operationHash: hash,
		expectedVersion: agentInteger(row.expectedVersion, 1),
	};
	if (feedback !== undefined) {
		result.feedback = feedback;
	}
	return result;
}

/** Strict, finite wire decoding for consumers; no storage or trusted authorization semantics. */
function capability(raw: unknown): AgentCapability {
	const result = AGENT_CAPABILITIES.find((v) => v === raw);
	if (result === undefined) {
		throw new InvalidAgentPayload();
	}
	return result;
}

function grantView(raw: unknown): AgentGrantView['grants'][number] {
	const row = record(raw, ['capability', 'schemaVersion', 'scope', 'grantedAt']);
	const id = capability(row.capability);
	if (row.schemaVersion !== 2) {
		throw new InvalidAgentPayload();
	}
	return {
		capability: id,
		schemaVersion: 2,
		scope: grantScope(row.scope, id),
		grantedAt: agentInteger(row.grantedAt),
	};
}

function definition(raw: unknown): AgentCapabilityDefinition {
	const row = record(raw, ['id', 'scopeKind', 'supportedTargets', 'defaultScope']);
	const id = capability(row.id);
	const targeted = AGENT_TARGET_CAPABILITIES.includes(id);
	if (
		row.scopeKind !== (targeted ? 'targets' : 'global') ||
		!Array.isArray(row.supportedTargets) ||
		row.supportedTargets.length !== (targeted ? 1 : 0) ||
		(targeted && row.supportedTargets[0] !== 'ssh')
	) {
		throw new InvalidAgentPayload();
	}
	return {
		id,
		scopeKind: targeted ? 'targets' : 'global',
		supportedTargets: targeted ? ['ssh'] : [],
		defaultScope: grantScope(row.defaultScope, id),
	};
}

export function readAgentGrantView(value: unknown): AgentGrantView {
	const row = agentRecord(
		value,
		['appId', 'policyRevision', 'definitions', 'grants'],
		AGENT_GOVERNANCE_MAX_RESPONSE_BYTES,
	);
	if (
		!Array.isArray(row.grants) ||
		row.grants.length > AGENT_CAPABILITIES.length ||
		!Array.isArray(row.definitions) ||
		row.definitions.length > AGENT_CAPABILITIES.length
	) {
		throw new InvalidAgentPayload();
	}
	const grants = row.grants.map(grantView);
	const definitions = row.definitions.map(definition);
	if (
		new Set(grants.map((g) => g.capability)).size !== grants.length ||
		new Set(definitions.map((d) => d.id)).size !== definitions.length
	) {
		throw new InvalidAgentPayload();
	}
	return { appId: readAgentId(row.appId), policyRevision: agentInteger(row.policyRevision), grants, definitions };
}

export function readAgentExecutionPolicyView(value: unknown): AgentExecutionPolicyView {
	const row = agentRecord(value, ['overrides', 'effective', 'version'], AGENT_GOVERNANCE_MAX_RESPONSE_BYTES);
	const overrides = readPolicyOverrides(row.overrides);
	const effective = readPolicyOverrides(row.effective);
	const keys = [...AGENT_EXECUTION_INTEGER_KEYS, 'contextCompactionMode', 'contextProfile'];
	if (Object.keys(effective).length !== keys.length || keys.some((key) => !(key in effective))) {
		throw new InvalidAgentPayload();
	}
	const mode = AGENT_EXECUTION_COMPACTION_MODES.find((v) => v === effective.contextCompactionMode);
	const profile = AGENT_EXECUTION_CONTEXT_PROFILES.find((v) => v === effective.contextProfile);
	if (!mode || !profile) {
		throw new InvalidAgentPayload();
	}
	const complete = {
		maxModelRequests: agentInteger(effective.maxModelRequests, 1),
		maxActiveExecutionSeconds: agentInteger(effective.maxActiveExecutionSeconds, 1),
		toolTimeoutSeconds: agentInteger(effective.toolTimeoutSeconds, 1),
		maxToolOutputBytes: agentInteger(effective.maxToolOutputBytes, 1),
		maxRecallItems: agentInteger(effective.maxRecallItems, 1),
		maxRecallBytes: agentInteger(effective.maxRecallBytes, 1),
		maxSubagentMessages: agentInteger(effective.maxSubagentMessages, 1),
		maxSubagentMessageBytes: agentInteger(effective.maxSubagentMessageBytes, 1),
		contextCompactionMode: mode,
		contextProfile: profile,
	};
	return { overrides, effective: complete, version: agentInteger(row.version) };
}

function inspection(raw: unknown): AgentApprovalView['inspection'] {
	const row = record(raw, ['toolName', 'toolVersion', 'risk', 'mutation', 'targetConnectionId', 'summary']);
	const risk = AGENT_APPROVAL_RISKS.find((item) => item === row.risk);
	if (!risk) {
		throw new InvalidAgentPayload();
	}
	if (
		typeof row.mutation !== 'boolean' ||
		(row.targetConnectionId !== null &&
			!(
				typeof row.targetConnectionId === 'number' &&
				Number.isSafeInteger(row.targetConnectionId) &&
				row.targetConnectionId > 0
			))
	) {
		throw new InvalidAgentPayload();
	}
	return {
		toolName: agentText(row.toolName, AGENT_APPROVAL_MAX_TOOL_NAME_BYTES),
		toolVersion: agentText(row.toolVersion, AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES),
		risk,
		mutation: row.mutation,
		targetConnectionId: row.targetConnectionId === null ? null : agentInteger(row.targetConnectionId, 1),
		summary: agentText(row.summary, AGENT_APPROVAL_MAX_SUMMARY_BYTES),
	};
}

export function readAgentApprovalView(value: unknown): AgentApprovalView {
	const row = agentRecord(
		value,
		[
			'id',
			'appId',
			'runId',
			'toolCallId',
			'operationHash',
			'kind',
			'status',
			'policyRevision',
			'inputRevision',
			'version',
			'requestedAt',
			'expiresAt',
			'decidedAt',
			'decidedByUserId',
			'consumedAt',
			'inspection',
		],
		AGENT_GOVERNANCE_MAX_RESPONSE_BYTES,
	);
	const status = AGENT_APPROVAL_STATUSES.find((v) => v === row.status);
	const kind = AGENT_APPROVAL_KINDS.find((v) => v === row.kind);
	if (
		!status ||
		!kind ||
		typeof row.operationHash !== 'string' ||
		!AGENT_APPROVAL_OPERATION_HASH_PATTERN.test(row.operationHash)
	) {
		throw new InvalidAgentPayload();
	}
	const result: AgentApprovalView = {
		id: readAgentId(row.id),
		appId: readAgentId(row.appId),
		runId: readAgentId(row.runId),
		toolCallId: readAgentId(row.toolCallId),
		operationHash: row.operationHash,
		kind,
		status,
		policyRevision: agentInteger(row.policyRevision),
		inputRevision: agentInteger(row.inputRevision),
		version: agentInteger(row.version, 1),
		requestedAt: agentInteger(row.requestedAt),
		expiresAt: agentInteger(row.expiresAt),
		decidedAt: row.decidedAt === null ? null : agentInteger(row.decidedAt),
		decidedByUserId: row.decidedByUserId === null ? null : agentInteger(row.decidedByUserId, 1),
		consumedAt: row.consumedAt === null ? null : agentInteger(row.consumedAt),
		inspection: inspection(row.inspection),
	};

	const decided = result.status === 'approved' || result.status === 'denied';
	if (
		result.expiresAt <= result.requestedAt ||
		result.inputRevision < 1 ||
		(decided
			? result.decidedAt === null || result.decidedByUserId === null
			: result.decidedAt !== null || result.decidedByUserId !== null) ||
		(result.decidedAt !== null &&
			(result.decidedAt < result.requestedAt || result.decidedAt >= result.expiresAt)) ||
		(result.consumedAt !== null &&
			(result.status !== 'approved' ||
				result.decidedAt === null ||
				result.consumedAt < result.decidedAt ||
				result.consumedAt >= result.expiresAt))
	) {
		throw new InvalidAgentPayload();
	}
	return result;
}

export function readAgentApprovalAfter(value: unknown): string | null {
	return value === null ? null : readAgentId(value);
}

export function readAgentApprovalPage(value: unknown, after: string | null): AgentApprovalPage {
	const row = agentRecord(value, ['items', 'after', 'nextCursor', 'hasMore'], AGENT_GOVERNANCE_MAX_RESPONSE_BYTES);
	if (
		!Array.isArray(row.items) ||
		row.items.length > AGENT_APPROVAL_MAX_PAGE_ITEMS ||
		row.after !== after ||
		typeof row.hasMore !== 'boolean'
	) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map(readAgentApprovalView);
	let previous = after;
	for (const item of items) {
		if (previous !== null && item.id <= previous) {
			throw new InvalidAgentPayload();
		}
		previous = item.id;
	}
	const nextCursor = readAgentApprovalAfter(row.nextCursor);
	if (nextCursor !== previous || (row.hasMore && items.length !== AGENT_APPROVAL_MAX_PAGE_ITEMS)) {
		throw new InvalidAgentPayload();
	}
	return { items, after, nextCursor, hasMore: row.hasMore };
}

export function readAgentApprovalQuery(query: URLSearchParams): string | null {
	if ([...query.keys()].some((key) => key !== 'after') || query.getAll('after').length > 1) {
		throw new InvalidAgentPayload();
	}
	return readAgentApprovalAfter(query.get('after'));
}

export function readAgentApprovalCommandHeaders(raw: unknown): AgentApprovalCommandHeaders {
	return { operationKey: readAgentId(raw) };
}

function denylistReason(input: unknown): string {
	const reason = agentText(input, AGENT_DENYLIST_MAX_REASON_BYTES).trim();
	if ([...reason].length > AGENT_DENYLIST_MAX_REASON_CODE_POINTS) {
		throw new InvalidAgentPayload();
	}
	return reason;
}

export function readAgentTargetDenylistReplaceRequest(input: unknown): AgentTargetDenylistReplaceRequest {
	const row = agentRecord(input, ['connectionIds', 'reason', 'expectedRevision'], AGENT_GOVERNANCE_MAX_BODY_BYTES);
	if (!Array.isArray(row.connectionIds) || row.connectionIds.length > AGENT_DENYLIST_MAX_TARGETS) {
		throw new InvalidAgentPayload();
	}
	return {
		connectionIds: [...new Set(row.connectionIds.map((id) => agentInteger(id, 1)))].sort((a, b) => a - b),
		reason: denylistReason(row.reason),
		expectedRevision: agentInteger(row.expectedRevision, 1),
	};
}

export function readAgentTargetDenylistResponse(input: unknown): AgentTargetDenylistView {
	const row = agentRecord(input, ['revision', 'entries'], AGENT_GOVERNANCE_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.entries) || row.entries.length > AGENT_DENYLIST_MAX_TARGETS) {
		throw new InvalidAgentPayload();
	}
	const entries = row.entries.map((value) => {
		const entry = agentRecord(value, ['connectionId', 'reason', 'changedBy', 'changedAt']);
		return {
			connectionId: agentInteger(entry.connectionId, 1),
			reason: denylistReason(entry.reason),
			changedBy: agentInteger(entry.changedBy, 1),
			changedAt: agentInteger(entry.changedAt),
		};
	});
	if (new Set(entries.map((entry) => entry.connectionId)).size !== entries.length) {
		throw new InvalidAgentPayload();
	}
	return { revision: agentInteger(row.revision, 1), entries };
}
