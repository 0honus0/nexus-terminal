import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import { SqliteScopeStorage } from './scope/adapters/sqlite/scope-sql.js';
import { ScopeModel } from './scope/model/scope-model.js';
import { ScopeService } from './scope/service/scope-service.js';
import { SqliteRunStorage } from './runs/adapters/sqlite/run-sql.js';
import { RunModel } from './runs/model/run-model.js';
import { RunService } from './runs/service/run-service.js';
import type { AgentApp, AgentThread } from './scope/model/scope-types.js';
import type {
	AgentRun,
	AgentRunEvent,
	CreateRunResult,
	CancelRunResult,
	RunEventPage,
} from './runs/model/run-types.js';
import type {
	AgentStateApi,
	AgentAppView,
	AgentThreadView,
	AgentRunView,
	AgentRunEventView,
	AgentCreateRunResult,
	AgentCancelRunResult,
	AgentEventPageView,
} from './public.js';
import { agentBoundary } from './agent-errors.js';
import type { AccessPublicApi } from '../access/public.js';
import type { HttpRoute } from '../../platform/http/http-types.js';
import { createAgentHttpRoutes } from './interfaces/http/agent-http.js';

function toAppView(value: AgentApp): AgentAppView {
	return { id: value.id, name: value.name, createdAt: value.createdAt };
}

function toThreadView(value: AgentThread): AgentThreadView {
	return { id: value.id, appId: value.appId, title: value.title, createdAt: value.createdAt };
}

function toRunView(value: AgentRun): AgentRunView {
	return {
		id: value.id,
		appId: value.appId,
		threadId: value.threadId,
		status: value.status,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toEventView(value: AgentRunEvent): AgentRunEventView {
	return {
		runId: value.runId,
		sequence: value.sequence,
		type: value.type,
		runVersion: value.runVersion,
		createdAt: value.createdAt,
	};
}

function toCreateResult(value: CreateRunResult): AgentCreateRunResult {
	if (value.status === 'replayed') {
		return { status: 'replayed', originalStatus: value.originalStatus, run: toRunView(value.run) };
	}
	if (value.status === 'created') {
		return { status: 'created', run: toRunView(value.run) };
	}
	return { status: value.status };
}

function toCancelResult(value: CancelRunResult): AgentCancelRunResult {
	if (value.status === 'replayed') {
		return { status: 'replayed', originalStatus: value.originalStatus, run: toRunView(value.run) };
	}
	if (value.status === 'cancelled' || value.status === 'already_cancelled') {
		return { status: value.status, run: toRunView(value.run) };
	}
	return { status: value.status };
}

function toEventPage(value: RunEventPage): AgentEventPageView {
	return { items: value.items.map(toEventView), nextCursor: value.nextCursor };
}

export interface AgentRegistration {
	publicApi: AgentStateApi;
	routes(access: AccessPublicApi): HttpRoute[];
}

export function registerAgent(sqlite: SqliteRuntime): AgentRegistration {
	const scope = new ScopeService(new ScopeModel(new SqliteScopeStorage(sqlite)));
	const runs = new RunService(new RunModel(new SqliteRunStorage(sqlite)));
	const publicApi: AgentStateApi = {
		createApp: (userId, name) => agentBoundary(async () => toAppView(await scope.createApp(userId, name))),

		createThread: (userId, appId, title) =>
			agentBoundary(async () => {
				const result = await scope.createThread(userId, appId, title);
				return result === null ? null : toThreadView(result);
			}),

		createRun: (input) =>
			agentBoundary(async () => {
				const result = await runs.create({
					userId: input.userId,
					appId: input.appId,
					threadId: input.threadId,
					prompt: input.prompt,
					operationKey: input.operationKey,
				});
				// TODO(agent/runtime/scheduling, execution batch): dispatch only after
				// a fresh 'created' commit; replay must never schedule a second execution.
				// No scheduler/provider exists in this slice: Run stays pending.
				return toCreateResult(result);
			}),

		cancelRun: (input) =>
			agentBoundary(async () => {
				const result = await runs.cancel({
					userId: input.userId,
					appId: input.appId,
					runId: input.runId,
					expectedVersion: input.expectedVersion,
					operationKey: input.operationKey,
				});
				// TODO(agent/runtime/scheduling, execution batch): emit committed
				// cancellation only when status is 'cancelled', never on replay/rollback.
				return toCancelResult(result);
			}),

		getRun: (userId, appId, id) =>
			agentBoundary(async () => {
				const run = await runs.get(userId, appId, id);
				return run === null ? null : toRunView(run);
			}),

		listEvents: (userId, appId, id, after, limit) =>
			agentBoundary(async () => {
				const result = await runs.listEvents(userId, appId, id, after, limit);
				return result === null ? null : toEventPage(result);
			}),
	};
	return {
		publicApi,

		routes: (access) => createAgentHttpRoutes(access, publicApi),
	};
}
