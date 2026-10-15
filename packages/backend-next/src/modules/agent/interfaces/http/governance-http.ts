import { toApproval } from './governance-mapper.js';
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
	readAgentApprovalResolveRequest,
	readAgentApprovalCommandHeaders,
} from '@nexus-terminal/shared/agent/governance/http-codec';
import { encodeAgentJson, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type {
	AgentGrantView,
	AgentExecutionPolicyView,
	AgentApprovalView,
	AgentGrantScope,
} from '@nexus-terminal/shared/agent/governance/model';
import type { AgentErrorResponse } from '@nexus-terminal/shared/agent/http';
import type { AgentExecutionPolicyOverrides } from '@nexus-terminal/shared/agent/governance/model';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { AgentOperationError } from '../../public-errors.js';
import { AgentFailure } from '../../agent-failure.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type {
	Approval,
	GrantScope,
	GrantCatalogState,
	ExecutionPolicy,
	PolicyOverrides,
} from '../../governance/model/governance-types.js';

type Response =
	| AgentGrantView
	| AgentExecutionPolicyView
	| AgentApprovalView
	| AgentApprovalView[]
	| AgentTargetDenylistView
	| AgentErrorResponse;

function send(ctx: HttpRouteContext, status: number, value: Response): void {
	try {
		encodeAgentJson(value, AGENT_GOVERNANCE_MAX_RESPONSE_BYTES);
	} catch {
		// A finite collection over the complete JSON response budget is a capacity failure.
		throw new AgentOperationError('limit_exceeded');
	}
	ctx.send(status, value);
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
	if (value.maxRecallItems !== undefined) {
		result.maxRecallItems = value.maxRecallItems;
	}
	if (value.maxRecallBytes !== undefined) {
		result.maxRecallBytes = value.maxRecallBytes;
	}
	if (value.maxSubagentMessages !== undefined) {
		result.maxSubagentMessages = value.maxSubagentMessages;
	}
	if (value.maxSubagentMessageBytes !== undefined) {
		result.maxSubagentMessageBytes = value.maxSubagentMessageBytes;
	}
	if (value.contextCompactionMode !== undefined) {
		result.contextCompactionMode = value.contextCompactionMode;
	}
	if (value.contextProfile !== undefined) {
		result.contextProfile = value.contextProfile;
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
	if (value.maxRecallItems !== undefined) {
		result.maxRecallItems = value.maxRecallItems;
	}
	if (value.maxRecallBytes !== undefined) {
		result.maxRecallBytes = value.maxRecallBytes;
	}
	if (value.maxSubagentMessages !== undefined) {
		result.maxSubagentMessages = value.maxSubagentMessages;
	}
	if (value.maxSubagentMessageBytes !== undefined) {
		result.maxSubagentMessageBytes = value.maxSubagentMessageBytes;
	}
	if (value.contextCompactionMode !== undefined) {
		result.contextCompactionMode = value.contextCompactionMode;
	}
	if (value.contextProfile !== undefined) {
		result.contextProfile = value.contextProfile;
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
		maxRecallItems: v.effective.maxRecallItems,
		maxRecallBytes: v.effective.maxRecallBytes,
		maxSubagentMessages: v.effective.maxSubagentMessages,
		maxSubagentMessageBytes: v.effective.maxSubagentMessageBytes,
		contextCompactionMode: v.effective.contextCompactionMode,
		contextProfile: v.effective.contextProfile,
	},
});

function fail(ctx: HttpRouteContext, error: unknown): void {
	if (error instanceof HttpInputFailure) {
		throw error;
	}
	if (error instanceof InvalidAgentPayload || (error instanceof AgentFailure && error.code === 'invalid_input')) {
		send(ctx, 400, { code: 'invalid_input' });
		return;
	}
	if (error instanceof AgentOperationError) {
		const code = error.code;
		send(ctx, agentErrorStatus(code), { code });
		return;
	}
	if (error instanceof AccessOperationError) {
		send(ctx, error.code === 'storage_unavailable' ? 503 : 500, {
			code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
		});
		return;
	}
	send(ctx, 500, { code: 'internal_failure' });
}

export function createGovernanceHttpRoutes(
	access: AccessPublicApi,
	governance: GovernanceService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute[] {
	const routes: HttpRoute[] = [];
	const base = '/api/v1';

	async function identity(ctx: HttpRouteContext): Promise<number | null> {
		const session = await access.authenticate(ctx.cookie(ACCESS_SESSION_COOKIE_NAME));
		if (session === null) {
			send(ctx, 401, { code: 'unauthenticated' });
			return null;
		}
		if (session.userId !== 1) {
			send(ctx, 403, { code: 'forbidden' });
			return null;
		}
		return session.userId;
	}

	type Handler = (ctx: HttpRouteContext, userId: number) => Promise<void>;

	function add(
		method: HttpRoute['method'],
		path: string,
		action: Handler,
		maxBodyBytes = AGENT_GOVERNANCE_MAX_BODY_BYTES,
	): void {
		routes.push({
			method,
			path: base + path,
			maxBodyBytes,

			async handle(ctx) {
				try {
					const userId = await identity(ctx);
					if (userId === null) {
						return;
					}
					if ([...ctx.query.keys()].length) {
						throw new InvalidAgentPayload();
					}
					await boundary(() => action(ctx, userId));
				} catch (error) {
					fail(ctx, error);
				}
			},
		});
	}

	async function deliver(ctx: HttpRouteContext, status: number, value: Response): Promise<void> {
		if ((await identity(ctx)) === null) {
			return;
		}
		send(ctx, status, value);
	}

	add('GET', '/agent/target-denylist', async (ctx, userId) => {
		await deliver(ctx, 200, toDenylist(await governance.denylist(userId)));
	});
	add('PUT', '/agent/target-denylist', async (ctx, userId) => {
		const input = readAgentTargetDenylistReplaceRequest(await ctx.json());
		const result = await governance.replaceDenylist({
			userId,
			expectedRevision: input.expectedRevision,
			connectionIds: input.connectionIds.map((id) => id),
			reason: input.reason,
		});
		await deliver(ctx, 200, toDenylist(result));
	});
	add('GET', '/agent/apps/:appId/grants', async (ctx, userId) => {
		const appId = readAgentGovernanceAppPath(ctx.params).appId;
		const grants = await governance.grants(userId, appId);
		if (!grants) {
			await deliver(ctx, 404, { code: 'not_found' });
			return;
		}
		await deliver(ctx, 200, toGrants(grants));
	});
	add(
		'PUT',
		'/agent/apps/:appId/grants',
		async (ctx, userId) => {
			const appId = readAgentGovernanceAppPath(ctx.params).appId;
			const request = readAgentGrantReplaceRequest(await ctx.json());
			const grants = await governance.replaceGrants(
				userId,
				appId,
				request.expectedPolicyRevision,
				request.grants.map((g) => ({ capability: g.capability, scope: fromPublicScope(g.scope) })),
			);
			if (!grants) {
				await deliver(ctx, 404, { code: 'not_found' });
				return;
			}
			await deliver(ctx, 200, toGrants(grants));
		},
		AGENT_GOVERNANCE_MAX_GRANT_BODY_BYTES,
	);
	add('GET', '/agent/apps/:appId/execution-policy', async (ctx, userId) => {
		const appId = readAgentGovernanceAppPath(ctx.params).appId;
		const policy = await governance.execution(userId, appId);
		await deliver(ctx, policy === null ? 404 : 200, policy === null ? { code: 'not_found' } : toPolicy(policy));
	});
	add('PUT', '/agent/apps/:appId/execution-policy', async (ctx, userId) => {
		const appId = readAgentGovernanceAppPath(ctx.params).appId;
		const request = readAgentExecutionPolicyReplaceRequest(await ctx.json());
		const policy = await governance.replaceExecution(
			userId,
			appId,
			request.expectedVersion,
			fromPublicPolicy(request.overrides),
		);
		await deliver(ctx, policy === null ? 404 : 200, policy === null ? { code: 'not_found' } : toPolicy(policy));
	});
	add('GET', '/apps/:appId/approvals/:approvalId', async (ctx, userId) => {
		const path = readAgentApprovalPath(ctx.params);
		const value = await governance.approval(userId, path.appId, path.approvalId);
		await deliver(ctx, value === null ? 404 : 200, value === null ? { code: 'not_found' } : toApproval(value));
	});
	add('GET', '/apps/:appId/runs/:runId/approvals', async (ctx, userId) => {
		const path = readAgentRunApprovalsPath(ctx.params);
		const items = await governance.approvals(userId, path.appId, path.runId);
		await deliver(ctx, items === null ? 404 : 200, items === null ? { code: 'not_found' } : items.map(toApproval));
	});
	add('POST', '/apps/:appId/approvals/:approvalId/resolve', async (ctx, userId) => {
		const path = readAgentApprovalPath(ctx.params);
		const request = readAgentApprovalResolveRequest(await ctx.json());
		const key = readAgentApprovalCommandHeaders(ctx.request.headers['idempotency-key']).operationKey;
		const result = await governance.resolve({
			userId,
			appId: path.appId,
			approvalId: path.approvalId,
			decision: request.decision,
			operationHash: request.operationHash,
			expectedVersion: request.expectedVersion,
			operationKey: key,
			feedback: request.feedback,
		});
		await deliver(ctx, 200, toApproval(result));
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
