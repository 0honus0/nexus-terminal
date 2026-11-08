import { agentHttpSerializer, agentHttpErrorHandler } from './agent-http-response.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { AgentHttpInput } from './agent-input.js';
import { toOperationApproval, toOperationApprovalPage } from './operation-approval-mapper.js';
import type { OperationApprovalService } from '../../governance/service/operation-approval-service.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { readAgentTargetDenylistReplaceRequest } from '@nexus-terminal/shared/agent/governance/http-codec';
import type { AgentTargetDenylistView } from '@nexus-terminal/shared/agent/governance/model';
import type { TargetDenylist } from '../../governance/model/governance-types.js';
import { agentErrorStatus } from './agent-http-status.js';
import {
	AGENT_GOVERNANCE_MAX_BODY_BYTES,
	AGENT_GOVERNANCE_MAX_RESPONSE_BYTES,
	AGENT_GOVERNANCE_MAX_GRANT_BODY_BYTES,
} from '@nexus-terminal/shared/agent/governance/values';
import {
	readAgentGovernanceAppPath,
	readAgentGrantReplaceRequest,
	readAgentExecutionPolicyReplaceRequest,
	readAgentApprovalPath,
	readAgentRunApprovalsPath,
	readAgentApprovalQuery,
	readAgentApprovalResolveRequest,
	readAgentApprovalCommandHeaders,
} from '@nexus-terminal/shared/agent/governance/http-codec';
import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type {
	AgentGrantView,
	AgentExecutionPolicyView,
	AgentApprovalView,
	AgentApprovalPage,
	AgentGrantScope,
} from '@nexus-terminal/shared/agent/governance/model';
import type { AgentErrorResponse } from '@nexus-terminal/shared/agent/http';
import type { AgentExecutionPolicyOverrides } from '@nexus-terminal/shared/agent/governance/model';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { AgentOperationError } from '../../public-errors.js';
import { AgentFailure } from '../../agent-failure.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type {
	GrantScope,
	GrantCatalogState,
	ExecutionPolicy,
	PolicyOverrides,
} from '../../governance/model/governance-types.js';

type Response =
	| AgentGrantView
	| AgentExecutionPolicyView
	| AgentApprovalView
	| AgentApprovalPage
	| AgentTargetDenylistView
	| AgentErrorResponse;

function send(reply: HttpReply, status: number, value: Response): void {
	reply
		.type('application/json; charset=utf-8')
		.serializer(agentHttpSerializer(AGENT_GOVERNANCE_MAX_RESPONSE_BYTES))
		.code(status)
		.send(value);
}

function toScope(scope: GrantScope): AgentGrantScope {
	if (scope.kind === 'global') {
		return { kind: 'global' };
	}
	const ssh = scope.targets.ssh;
	if (ssh === undefined) {
		return { kind: 'targets', targets: {} };
	}
	if (ssh.mode === 'all') {
		return { kind: 'targets', targets: { ssh: { mode: 'all' } } };
	}
	return { kind: 'targets', targets: { ssh: { mode: 'ids', ids: ssh.ids.map((id) => id) } } };
}

function toGrants(value: GrantCatalogState): AgentGrantView {
	return {
		appId: value.appId,
		policyRevision: value.revision,
		definitions: value.definitions.map((definition) => ({
			id: definition.id,
			scopeKind: definition.scopeKind,
			supportedTargets: definition.supportedTargets.map((target) => target),
			defaultScope: toScope(definition.defaultScope),
		})),
		grants: value.grants.map((g) => ({
			capability: g.capability,
			schemaVersion: 2,
			scope: toScope(g.scope),
			grantedAt: g.grantedAt,
		})),
	};
}

/** Both directions of the HTTP policy boundary use an explicit field whitelist. */
function fromPublicPolicy(value: AgentExecutionPolicyOverrides): PolicyOverrides {
	const result: PolicyOverrides = {};
	if (value.maxModelRequests !== undefined) {
		result.maxModelRequests = value.maxModelRequests;
	}
	if (value.maxActiveExecutionSeconds !== undefined) {
		result.maxActiveExecutionSeconds = value.maxActiveExecutionSeconds;
	}
	if (value.toolTimeoutSeconds !== undefined) {
		result.toolTimeoutSeconds = value.toolTimeoutSeconds;
	}
	if (value.maxToolOutputBytes !== undefined) {
		result.maxToolOutputBytes = value.maxToolOutputBytes;
	}
	if (value.maxSubagentMessages !== undefined) {
		result.maxSubagentMessages = value.maxSubagentMessages;
	}
	if (value.maxSubagentMessageBytes !== undefined) {
		result.maxSubagentMessageBytes = value.maxSubagentMessageBytes;
	}
	return result;
}

function toPublicPolicy(value: PolicyOverrides): AgentExecutionPolicyOverrides {
	const result: AgentExecutionPolicyOverrides = {};
	if (value.maxModelRequests !== undefined) {
		result.maxModelRequests = value.maxModelRequests;
	}
	if (value.maxActiveExecutionSeconds !== undefined) {
		result.maxActiveExecutionSeconds = value.maxActiveExecutionSeconds;
	}
	if (value.toolTimeoutSeconds !== undefined) {
		result.toolTimeoutSeconds = value.toolTimeoutSeconds;
	}
	if (value.maxToolOutputBytes !== undefined) {
		result.maxToolOutputBytes = value.maxToolOutputBytes;
	}
	if (value.maxSubagentMessages !== undefined) {
		result.maxSubagentMessages = value.maxSubagentMessages;
	}
	if (value.maxSubagentMessageBytes !== undefined) {
		result.maxSubagentMessageBytes = value.maxSubagentMessageBytes;
	}
	return result;
}

function fromPublicScope(scope: AgentGrantScope): GrantScope {
	if (scope.kind === 'global') {
		return { kind: 'global' };
	}
	const ssh = scope.targets.ssh;
	if (ssh === undefined) {
		return { kind: 'targets', targets: {} };
	}
	if (ssh.mode === 'all') {
		return { kind: 'targets', targets: { ssh: { mode: 'all' } } };
	}
	return { kind: 'targets', targets: { ssh: { mode: 'ids', ids: ssh.ids.map((id) => id) } } };
}

const toPolicy = (v: ExecutionPolicy): AgentExecutionPolicyView => ({
	version: v.version,
	overrides: toPublicPolicy(v.overrides),
	effective: {
		maxModelRequests: v.effective.maxModelRequests,
		maxActiveExecutionSeconds: v.effective.maxActiveExecutionSeconds,
		toolTimeoutSeconds: v.effective.toolTimeoutSeconds,
		maxToolOutputBytes: v.effective.maxToolOutputBytes,
		maxSubagentMessages: v.effective.maxSubagentMessages,
		maxSubagentMessageBytes: v.effective.maxSubagentMessageBytes,
	},
});

function fail(reply: HttpReply, error: unknown): void {
	if (error instanceof InvalidAgentPayload || (error instanceof AgentFailure && error.code === 'invalid_input')) {
		send(reply, 400, { code: 'invalid_input' });
		return;
	}
	if (error instanceof AgentOperationError) {
		const code = error.code;
		send(reply, agentErrorStatus(code), { code });
		return;
	}
	if (error instanceof AccessOperationError) {
		send(reply, error.code === 'storage_unavailable' ? 503 : 500, {
			code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
		});
		return;
	}
	send(reply, 500, { code: 'internal_failure' });
}

export function createGovernanceHttpRoutes(
	access: AccessPublicApi,
	governance: GovernanceService,
	approvals: OperationApprovalService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute[] {
	const routes: HttpRoute[] = [];
	const base = '/api/v1';

	async function identity(httpRequest: HttpRequest, reply: HttpReply): Promise<number | null> {
		const session = await access.authenticate(readRequestCookie(httpRequest.raw, ACCESS_SESSION_COOKIE_NAME));
		if (session === null) {
			send(reply, 401, { code: 'unauthenticated' });
			return null;
		}
		if (session.userId !== 1) {
			send(reply, 403, { code: 'forbidden' });
			return null;
		}
		return session.userId;
	}

	type Handler = (httpRequest: HttpRequest, reply: HttpReply, userId: number) => Promise<void>;

	function add(
		method: HttpRoute['method'],
		path: string,
		action: Handler,
		maxBodyBytes = AGENT_GOVERNANCE_MAX_BODY_BYTES,
		queryKeys: readonly string[] = [],
	): void {
		routes.push({
			method,
			url: base + path,
			bodyLimit: maxBodyBytes,
			errorHandler: agentHttpErrorHandler,

			async handler(httpRequest, reply) {
				const inputBoundary = new AgentHttpInput(httpRequest);
				try {
					const userId = await identity(httpRequest, reply);
					if (userId === null) {
						return;
					}
					if ([...httpRequest.query.keys()].some((key) => !queryKeys.includes(key))) {
						throw new InvalidAgentPayload();
					}
					await boundary(() => inputBoundary.normalize(() => action(httpRequest, reply, userId)));
				} catch (error) {
					fail(reply, error);
				}
			},
		});
	}

	async function deliver(httpRequest: HttpRequest, reply: HttpReply, status: number, value: Response): Promise<void> {
		if ((await identity(httpRequest, reply)) === null) {
			return;
		}
		send(reply, status, value);
	}

	add('GET', '/agent/target-denylist', async (httpRequest, reply, userId) => {
		await deliver(httpRequest, reply, 200, toDenylist(await governance.denylist(userId)));
	});
	add('PUT', '/agent/target-denylist', async (httpRequest, reply, userId) => {
		const input = readAgentTargetDenylistReplaceRequest(httpRequest.body);
		const result = await governance.replaceDenylist({
			userId,
			expectedRevision: input.expectedRevision,
			connectionIds: input.connectionIds.map((id) => id),
			reason: input.reason,
		});
		await deliver(httpRequest, reply, 200, toDenylist(result));
	});
	add('GET', '/agent/apps/:appId/grants', async (httpRequest, reply, userId) => {
		const appId = readAgentGovernanceAppPath(httpRequest.params).appId;
		const grants = await governance.grants(userId, appId);
		if (!grants) {
			await deliver(httpRequest, reply, 404, { code: 'not_found' });
			return;
		}
		await deliver(httpRequest, reply, 200, toGrants(grants));
	});
	add(
		'PUT',
		'/agent/apps/:appId/grants',
		async (httpRequest, reply, userId) => {
			const appId = readAgentGovernanceAppPath(httpRequest.params).appId;
			const request = readAgentGrantReplaceRequest(httpRequest.body);
			const grants = await governance.replaceGrants(
				userId,
				appId,
				request.expectedPolicyRevision,
				request.grants.map((g) => ({ capability: g.capability, scope: fromPublicScope(g.scope) })),
			);
			if (!grants) {
				await deliver(httpRequest, reply, 404, { code: 'not_found' });
				return;
			}
			await deliver(httpRequest, reply, 200, toGrants(grants));
		},
		AGENT_GOVERNANCE_MAX_GRANT_BODY_BYTES,
	);
	add('GET', '/agent/apps/:appId/execution-policy', async (httpRequest, reply, userId) => {
		const appId = readAgentGovernanceAppPath(httpRequest.params).appId;
		const policy = await governance.execution(userId, appId);
		await deliver(
			httpRequest,
			reply,
			policy === null ? 404 : 200,
			policy === null ? { code: 'not_found' } : toPolicy(policy),
		);
	});
	add('PUT', '/agent/apps/:appId/execution-policy', async (httpRequest, reply, userId) => {
		const appId = readAgentGovernanceAppPath(httpRequest.params).appId;
		const request = readAgentExecutionPolicyReplaceRequest(httpRequest.body);
		const policy = await governance.replaceExecution(
			userId,
			appId,
			request.expectedVersion,
			fromPublicPolicy(request.overrides),
		);
		await deliver(
			httpRequest,
			reply,
			policy === null ? 404 : 200,
			policy === null ? { code: 'not_found' } : toPolicy(policy),
		);
	});
	add('GET', '/apps/:appId/approvals/:approvalId', async (httpRequest, reply, userId) => {
		const path = readAgentApprovalPath(httpRequest.params);
		const value = await approvals.get(userId, path.appId, path.approvalId);
		await deliver(
			httpRequest,
			reply,
			value === null ? 404 : 200,
			value === null ? { code: 'not_found' } : toOperationApproval(value),
		);
	});
	add(
		'GET',
		'/apps/:appId/runs/:runId/approvals',
		async (httpRequest, reply, userId) => {
			const path = readAgentRunApprovalsPath(httpRequest.params);
			const items = await approvals.page(
				userId,
				path.appId,
				path.runId,
				readAgentApprovalQuery(httpRequest.query),
			);
			await deliver(
				httpRequest,
				reply,
				items === null ? 404 : 200,
				items === null ? { code: 'not_found' } : toOperationApprovalPage(items),
			);
		},
		AGENT_GOVERNANCE_MAX_BODY_BYTES,
		['after'],
	);
	add('POST', '/apps/:appId/approvals/:approvalId/resolve', async (httpRequest, reply, userId) => {
		const path = readAgentApprovalPath(httpRequest.params);
		const request = readAgentApprovalResolveRequest(httpRequest.body);
		const key = readAgentApprovalCommandHeaders(httpRequest.headers['idempotency-key']).operationKey;
		const token = readRequestCookie(httpRequest.raw, ACCESS_SESSION_COOKIE_NAME);
		if (!token) {
			throw new AgentFailure('unauthenticated');
		}
		const result = await approvals.resolve(
			{ userId, token },
			{
				appId: path.appId,
				approvalId: path.approvalId,
				decision: request.decision,
				operationHash: request.operationHash,
				expectedVersion: request.expectedVersion,
				operationKey: key,
				feedback: request.feedback,
			},
		);
		await deliver(httpRequest, reply, 200, toOperationApproval(result));
	});
	return routes;
}

function toDenylist(value: TargetDenylist): AgentTargetDenylistView {
	return {
		revision: value.revision,
		entries: value.entries.map((entry) => ({
			connectionId: entry.connectionId,
			reason: entry.reason,
			changedBy: entry.changedBy,
			changedAt: Math.floor(entry.changedAt / 1000),
		})),
	};
}
