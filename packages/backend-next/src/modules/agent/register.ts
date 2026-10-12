import type { AgentAppView, AgentThreadView } from '@nexus-terminal/shared/agent/scope/model';
import type {
	AgentRunView,
	AgentRunEventView,
	AgentRunStepView,
	AgentRunStepEventView,
} from '@nexus-terminal/shared/agent/runs/model';
import type { AgentRunEventsResponse, AgentRunStepEventsResponse } from '@nexus-terminal/shared/agent/runs/http';
import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import type { SecretBox } from '../../platform/security/secret-box.js';
import { OpenAiCompatibleAdapter } from '../../platform/ai/adapters/openai-compatible.js';
import { SqliteProviderStorage } from './providers/adapters/sqlite/provider-sql.js';
import { ProviderModel } from './providers/model/provider-model.js';
import { ProviderService } from './providers/service/provider-service.js';
import type { AgentProviderApi } from './providers/model/provider-api-types.js';
import { createAgentProviderHttpRoutes } from './interfaces/http/provider-http.js';
import { SqliteCapabilityRegistryStorage } from './providers/registry/adapters/sqlite/registry-sql.js';
import { CapabilityRegistryModel } from './providers/registry/model/registry-model.js';
import { CapabilityRegistryService } from './providers/registry/service/registry-service.js';
import { ModelsDevCatalogAdapter } from '../../platform/ai/adapters/model-catalog.js';
import { SqliteScopeStorage } from './scope/adapters/sqlite/scope-sql.js';
import { ScopeModel } from './scope/model/scope-model.js';
import { ScopeService } from './scope/service/scope-service.js';
import { SqliteRunStorage } from './runs/adapters/sqlite/run-sql.js';
import { SqliteRunStepStorage } from './runs/adapters/sqlite/run-step-sql.js';
import { RunModel } from './runs/model/run-model.js';
import { RunStepModel } from './runs/model/run-step-model.js';
import { RunModelStream } from './runs/model/run-model-stream.js';
import { RunExecutionOwner } from './runs/service/run-execution-owner.js';
import { RunService } from './runs/service/run-service.js';
import type { AgentApp, AgentThread } from './scope/model/scope-types.js';
import type {
	AgentRun,
	AgentRunEvent,
	CreateRunResult,
	CancelRunResult,
	RunEventPage,
	RunModelStep,
	RunStepEvent,
	RunStepEventPage,
} from './runs/model/run-types.js';
import type { AgentStateApi, AgentCreateRunResult, AgentCancelRunResult } from './public.js';
import { AgentRequestOwner } from './service/agent-request-owner.js';
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

function toEventPage(value: RunEventPage): AgentRunEventsResponse {
	return { items: value.items.map(toEventView), nextCursor: value.nextCursor };
}

function toStepView(value: RunModelStep): AgentRunStepView {
	return {
		runId: value.runId,
		stepIndex: value.stepIndex,
		state: value.state,
		revision: value.revision,
		runVersion: value.runVersion,
		textBytes: value.textBytes,
		...(value.finishReason === undefined ? {} : { finishReason: value.finishReason }),
		...(value.inputTokens === undefined
			? {}
			: { inputTokens: value.inputTokens, outputTokens: value.outputTokens }),
		...(value.failureCode === undefined ? {} : { failureCode: value.failureCode }),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toStepEventView(runId: string, value: RunStepEvent): AgentRunStepEventView {
	const identity = { runId, stepIndex: value.stepIndex, sequence: value.sequence, createdAt: value.createdAt };
	if (value.kind === 'text.delta') {
		if (value.textDelta === undefined) {
			throw new Error('Missing persisted text delta');
		}
		return { ...identity, kind: 'text.delta', textBytes: Buffer.byteLength(value.textDelta, 'utf8') };
	}
	if (value.kind === 'usage') {
		if (value.inputTokens === undefined || value.outputTokens === undefined) {
			throw new Error('Missing persisted usage');
		}
		return { ...identity, kind: 'usage', inputTokens: value.inputTokens, outputTokens: value.outputTokens };
	}
	return { ...identity, kind: value.kind };
}

function toStepEventPage(runId: string, value: RunStepEventPage): AgentRunStepEventsResponse {
	return { items: value.items.map((event) => toStepEventView(runId, event)), nextCursor: value.nextCursor };
}

export interface AgentRegistration {
	publicApi: AgentStateApi;
	initialize(): Promise<void>;
	quiesce(): void;
	close(): Promise<void>;
	routes(access: AccessPublicApi): HttpRoute[];
}

export function registerAgent(sqlite: SqliteRuntime, secrets: SecretBox | null): AgentRegistration {
	const scope = new ScopeService(new ScopeModel(new SqliteScopeStorage(sqlite)));
	const providerStorage = new SqliteProviderStorage(sqlite);
	const network = new OpenAiCompatibleAdapter();
	const providerModel = new ProviderModel(providerStorage, secrets, network);
	const registryService = new CapabilityRegistryService(
		new CapabilityRegistryModel(new SqliteCapabilityRegistryStorage(sqlite), new ModelsDevCatalogAdapter()),
	);
	const steps = new RunStepModel(new SqliteRunStepStorage(sqlite, providerStorage));
	const runModel = new RunModel(new SqliteRunStorage(sqlite, providerStorage));
	const execution = new RunExecutionOwner(runModel, steps, new RunModelStream(network), providerModel);
	const runs = new RunService(runModel, steps, execution);
	const providerService = new ProviderService(providerModel, (userId, providerId) =>
		execution.abortProvider(userId, providerId),
	);
	const requests = new AgentRequestOwner([execution, providerService, registryService]);

	function boundary<T>(work: () => Promise<T>): Promise<T> {
		return agentBoundary(() => requests.run(work));
	}

	const providerApi: AgentProviderApi = {
		registryStatus: (userId) => boundary(() => registryService.status(userId)),

		registryResolve: (userId, modelId) => boundary(() => registryService.resolve(userId, modelId)),

		registryRefresh: (userId, signal) => boundary(() => registryService.refresh(userId, signal)),

		list: (userId) => boundary(() => providerService.list(userId)),

		get: (userId, id) => boundary(() => providerService.get(userId, id)),

		create: (userId, input) => boundary(() => providerService.create(userId, input)),

		update: (userId, id, version, input) => boundary(() => providerService.update(userId, id, version, input)),

		remove: (userId, id, version) => boundary(() => providerService.remove(userId, id, version)),

		available: (userId) => boundary(() => providerService.available(userId)),

		discover: (userId, id, authorizeBeforeWrite, signal) =>
			boundary(() => providerService.discover(userId, id, authorizeBeforeWrite, signal)),

		discoverEndpoint: (userId, url, credential, signal) =>
			boundary(() => providerService.discoverEndpoint(userId, url, credential, signal)),

		test: (userId, id, modelId, signal) => boundary(() => providerService.test(userId, id, modelId, signal)),
	};
	const publicApi: AgentStateApi = {
		createApp: (userId, name) => boundary(async () => toAppView(await scope.createApp(userId, name))),

		createThread: (userId, appId, title) =>
			boundary(async () => {
				const result = await scope.createThread(userId, appId, title);
				return result === null ? null : toThreadView(result);
			}),

		createRun: (input) =>
			boundary(async () => {
				const result = await runs.create({
					userId: input.userId,
					appId: input.appId,
					threadId: input.threadId,
					prompt: input.prompt,
					model: {
						providerId: input.model.providerId,
						modelId: input.model.modelId,
						configurationVersion: input.model.configurationVersion,
					},
					operationKey: input.operationKey,
				});
				// Only a newly committed Run enters the execution owner; its frozen
				// policy currently denies remote dispatch. Replays never restart it.
				return toCreateResult(result);
			}),

		cancelRun: (input) =>
			boundary(async () => {
				const result = await runs.cancel({
					userId: input.userId,
					appId: input.appId,
					runId: input.runId,
					expectedVersion: input.expectedVersion,
					operationKey: input.operationKey,
				});
				// Cancellation commits the durable fence before aborting the local attempt.
				return toCancelResult(result);
			}),

		getRun: (userId, appId, id) =>
			boundary(async () => {
				const run = await runs.get(userId, appId, id);
				return run === null ? null : toRunView(run);
			}),

		listEvents: (userId, appId, id, after, limit) =>
			boundary(async () => {
				const result = await runs.listEvents(userId, appId, id, after, limit);
				return result === null ? null : toEventPage(result);
			}),

		getStep: (userId, appId, runId, index) =>
			boundary(async () => {
				const result = await runs.getStep(userId, appId, runId, index);
				return result === null ? null : toStepView(result);
			}),

		listStepEvents: (userId, appId, runId, index, after, limit) =>
			boundary(async () => {
				const result = await runs.listStepEvents(userId, appId, runId, index, after, limit);
				return result === null ? null : toStepEventPage(runId, result);
			}),
	};
	return {
		publicApi,

		// Reconcile persisted incomplete dispatches BEFORE accepting requests;
		// never redispatch a request whose upstream effects are unknown.
		initialize: async () => {
			await steps.reconcileUnsettled(Date.now());
		},

		quiesce: () => requests.quiesce(),

		close: () => requests.close(),

		routes: (access) => [
			...createAgentHttpRoutes(access, publicApi),
			...createAgentProviderHttpRoutes(access, providerApi),
		],
	};
}
