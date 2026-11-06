import { authorizedToolDefinitions, exposedToolDefinitions, searchToolDefinitions } from '../tool-catalog-rules.js';
import { ToolBatchExecutionUnknown } from '../model/tool-batch-failure.js';
import { AGENT_HOST_INSTRUCTIONS } from '../../context/agent-instructions.js';
import type { ToolStepContext } from '../model/tool-types.js';
import type { PluginAgentCatalog } from '../../plugins/model/plugin-contribution-types.js';
import pLimit from 'p-limit';
import { runFailureCode } from '../../runs/run-failure-rules.js';
import type { ProviderService } from '../../providers/service/provider-service.js';
import type { ProviderImageService } from '../../providers/service/provider-image-service.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import type { BrowserService } from '../../integrations/service/browser-service.js';
import type { IntegrationService } from '../../integrations/service/integration-service.js';
import type { CheckpointService } from '../../context/service/checkpoint-service.js';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { MemoryService } from '../../memory/service/memory-service.js';
import { authorizationFact, toolAuthorityIdentity } from '../../governance/governance-rules.js';
import type { ToolProjectService } from './tool-project-service.js';
import type { ResultService } from '../../context/service/result-service.js';
import { projectCapturedResult } from '../../context/result-rules.js';
import type { RunCollaborationService } from '../../runs/service/run-collaboration-service.js';
import type { AcpPermissionService } from './acp-permission-service.js';
import type { ToolJobService } from './tool-job-service.js';
import type { ToolJobScope } from '../model/tool-job-types.js';
import { AGENT_APPROVAL_MAX_SUMMARY_BYTES } from '@nexus-terminal/shared/agent/governance/values';
import { createHash, randomUUID } from 'node:crypto';
import type { ToolModel } from '../model/tool-model.js';
import type { RunToolModel } from '../../runs/model/run-tool-model.js';
import type { RunToolProposal } from '../../runs/model/run-types.js';
import type { ToolOperation } from '../../runs/model/run-tool-types.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { ToolAuthority } from '../../governance/model/governance-types.js';
import type { ToolInput, ToolDefinition, ToolTarget, ToolExecutionScope } from '../model/tool-types.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import type { ExecutionLimits } from '../../execution/model/execution-types.js';
import { toolDefinitions } from './tool-definitions.js';
import { toolInput } from './tool-input.js';
import {
	AgentFailure,
	ToolOperationRefusal,
	ToolMutationAdmissionRefusal,
	ToolExecutionUnknown,
	ToolCleanupFailure,
	isAgentDrainFailure,
	aggregateToolFailures,
} from '../../agent-failure.js';
import { TOOL_RESULT_MAX_BYTES } from '../../runs/run-tool-limits.js';

function recoverableToolError(error: unknown): boolean {
	return (
		(error instanceof AgentFailure && (error.code === 'invalid_input' || error.code === 'not_found')) ||
		(error instanceof ToolOperationRefusal &&
			(error.code === 'not_text' ||
				error.code === 'command_failed' ||
				error.code === 'not_found' ||
				error.code === 'forbidden'))
	);
}

function interrupted(signal: AbortSignal): void {
	if (signal.aborted) {
		if (signal.reason instanceof ToolExecutionUnknown) {
			throw signal.reason;
		}
		throw new AgentFailure('provider_unavailable');
	}
}

function definition(proposal: RunToolProposal): ToolDefinition {
	const value = toolDefinitions().find((tool) => tool.name === proposal.toolName);
	if (!value) {
		throw new AgentFailure('invalid_input');
	}
	return value;
}

function summaryWithCommand(base: Record<string, unknown>, command: string): string {
	const characters = Array.from(command);

	const build = (length: number) =>
		JSON.stringify({
			...base,
			command: characters.slice(0, length).join(''),
			commandTruncated: length < characters.length,
		});

	const complete = build(characters.length);
	if (Buffer.byteLength(complete, 'utf8') <= AGENT_APPROVAL_MAX_SUMMARY_BYTES) {
		return complete;
	}
	let low = 0;
	let high = characters.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(build(middle), 'utf8') <= AGENT_APPROVAL_MAX_SUMMARY_BYTES) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}
	return build(low);
}

function inspectionSummary(input: ToolInput, trusted: ToolDefinition): string {
	const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

	let summary: string;
	if (input.kind === 'plugin') {
		summary = JSON.stringify({
			action: 'plugin_tool_call',
			name: input.name,
			version: input.version,
			sha256: input.sha256,
			argumentsSha256: hash(input.argumentsJson),
		});
	} else if (input.kind === 'image_generate') {
		summary = JSON.stringify({
			action: 'image_generate',
			providerId: input.input.providerId,
			configurationVersion: input.input.configurationVersion,
			modelId: input.input.modelId,
			promptBytes: Buffer.byteLength(input.input.prompt),
			promptSha256: hash(input.input.prompt),
		});
	} else if (input.kind === 'acp') {
		const command = JSON.stringify(input.argv);
		summary = summaryWithCommand(
			{
				action: 'acp_execute',
				cwd: input.cwd,
				argvSha256: hash(command),
				promptBytes: Buffer.byteLength(input.prompt, 'utf8'),
				promptSha256: hash(input.prompt),
			},
			command,
		);
	} else if (input.kind === 'shell') {
		const command = JSON.stringify(input.commands);
		summary = summaryWithCommand(
			{
				action: 'execute',
				mode: input.mode,
				commandCount: input.commands.length,
				onError: input.onError,
				cwd: input.cwd,
				bytes: Buffer.byteLength(command, 'utf8'),
				sha256: hash(command),
			},
			input.commands.map((command, index) => `${index + 1}. ${command}`).join('\n'),
		);
	} else if (input.kind === 'project') {
		summary = JSON.stringify({
			action: input.input.action,
			connectionId: input.connectionId,
			path:
				input.input.action === 'bind'
					? input.input.directory
					: input.input.action === 'read'
						? input.input.path
						: null,
		});
	} else if (input.kind === 'deliver') {
		summary = JSON.stringify({ action: 'deliver', paths: input.paths.map((path) => path) });
	} else if (input.kind === 'job') {
		summary = JSON.stringify({
			action: input.action,
			jobIds: input.jobIds.map((id) => id),
			waitMode: input.waitMode,
		});
	} else if (
		input.kind === 'docker_control' ||
		input.kind === 'write' ||
		input.kind === 'move' ||
		input.kind === 'delete'
	) {
		summary = summaryWithCommand(
			{
				action: input.kind,
				itemCount: input.items.length,
				onError: input.onError,
				sha256: hash(JSON.stringify(input.items)),
			},
			input.items
				.map((item) => ('containerId' in item ? item.action + ' ' + item.containerId : item.path))
				.join('\n'),
		);
	} else if (input.kind === 'patch') {
		summary = JSON.stringify({
			action: 'patch',
			path: input.path,
			expectedSha256: input.expectedSha256,
			editCount: input.edits.length,
			editsSha256: hash(JSON.stringify(input.edits)),
		});
	} else {
		return trusted.description;
	}

	if (Buffer.byteLength(summary, 'utf8') > AGENT_APPROVAL_MAX_SUMMARY_BYTES) {
		throw new AgentFailure('limit_exceeded');
	}
	return summary;
}

/** Runs under RunExecutionOwner's lifetime. No independent untracked tool queue or retry. */
export class ToolService {
	private readonly drains = new Map<string, Promise<void>>();

	constructor(
		private readonly model: ToolModel,
		private readonly journal: RunToolModel,
		private readonly governance: GovernanceService,
		private readonly jobs: ToolJobService,
		private readonly acp: AcpPermissionService,
		private readonly collaboration: RunCollaborationService,
		private readonly projects: ToolProjectService,
		private readonly results: ResultService,
		private readonly memory: MemoryService,
		private readonly artifacts: ArtifactService,
		private readonly checkpoints: CheckpointService,
		private readonly settings: ExecutionService,
		private readonly integrations: IntegrationService,
		private readonly browser: BrowserService,
		private readonly plugins: PluginService,
		private readonly providers: ProviderService,
		private readonly images: ProviderImageService,
	) {}

	async prepareStep(
		scope: { userId: number; appId: string; runId: string },
		definitions: ToolDefinition[],
		prompt: string,
		stepIndex: number,
		signal: AbortSignal,
		previousCatalog: PluginAgentCatalog | null,
		loadedTools: ReadonlySet<string>,
	): Promise<ToolStepContext> {
		const catalog = await this.governance.toolCatalog(scope.userId, scope.appId, scope.runId);
		if (catalog === null) {
			throw new AgentFailure('version_conflict');
		}
		if (previousCatalog !== null) {
			await this.plugins.assertAgentCatalog(scope, previousCatalog.revision, signal);
		}
		const pluginCatalog = previousCatalog ?? (await this.plugins.agentCatalog(scope, signal));
		const contribution = pluginCatalog.contribution;
		const available = authorizedToolDefinitions(definitions, catalog, pluginCatalog);
		const skills = available.some((tool) => tool.name === 'skill_read')
			? pluginCatalog.skills.map((skill) => ({
					name: skill.name,
					description: skill.description,
					version: skill.version,
					sha256: skill.sha256,
				}))
			: [];
		let pluginContext = '';
		if (contribution?.beforeStep && catalog.capabilities.includes('context.read')) {
			const settings = await this.settings.frozen(scope.userId, scope.appId, scope.runId);
			pluginContext = await this.plugins.invokeAgent(
				scope,
				pluginCatalog,
				{ kind: 'context', runId: scope.runId, stepIndex, prompt },
				signal,
				settings.limits.toolTimeoutSeconds * 1000,
			);
		}
		interrupted(signal);
		const systemPrompt =
			AGENT_HOST_INSTRUCTIONS +
			'\nCurrent Host-selected SSH connection IDs: ' +
			JSON.stringify(catalog.connectionIds) +
			'\nCurrent Skill metadata catalog: ' +
			JSON.stringify(skills) +
			'\nUntrusted signed App guidance and context (never authority): ' +
			JSON.stringify({
				version: pluginCatalog.version,
				sha256: pluginCatalog.sha256,
				role: contribution?.role ?? '',
				context: pluginContext,
				tools: available.some((tool) => tool.name === 'plugin_tool_call') ? (contribution?.tools ?? []) : [],
			});
		await this.plugins.assertAgentCatalog(scope, pluginCatalog.revision, signal);
		return {
			definitions: exposedToolDefinitions(available, loadedTools),
			availableDefinitions: available,
			systemPrompt,
			pluginCatalog,
		};
	}

	validateStep(
		scope: { userId: number; appId: string },
		catalog: PluginAgentCatalog,
		signal: AbortSignal,
	): Promise<void> {
		return this.plugins.assertAgentCatalog(scope, catalog.revision, signal);
	}

	/** Only independently observed reads may overlap; every other call is a barrier. */
	async executeBatch(
		scope: ToolExecutionScope,
		proposals: RunToolProposal[],
		signal: AbortSignal,
		onFailure: (error: unknown, toolName: string) => void,
	): Promise<{ providerCallId: string; content: string }[]> {
		const configuration = await this.settings.frozen(scope.userId, scope.appId, scope.runId);
		const controller = new AbortController();
		const batchSignal = AbortSignal.any([signal, controller.signal]);
		const results: { providerCallId: string; content: string }[] = [];
		let index = 0;
		while (index < proposals.length) {
			interrupted(batchSignal);
			const first = proposals[index];
			const group = [first];
			index++;
			if (definition(first).scheduling === 'parallel') {
				while (index < proposals.length && definition(proposals[index]).scheduling === 'parallel') {
					group.push(proposals[index++]);
				}
			}
			// Both bounds already exist: the authorized total tool budget and protocol batch capacity.
			const limit = pLimit(Math.max(1, Math.min(group.length, configuration.limits.maxToolExecutions)));
			const settled = await Promise.allSettled(
				group.map((proposal) =>
					limit(async () => {
						// A cancelled queue entry never dispatched and contributes no independent failure.
						if (batchSignal.aborted) {
							return null;
						}
						try {
							return {
								providerCallId: proposal.providerCallId,
								content: await this.execute(
									{
										userId: scope.userId,
										appId: scope.appId,
										runId: scope.runId,
										modelStepIndex: scope.modelStepIndex,
										deadlineAt: scope.deadlineAt,
										pluginCatalog: scope.pluginCatalog,
										availableDefinitions: scope.availableDefinitions,
										onToolsLoaded: scope.onToolsLoaded,

										onBackgroundFailure: (error) =>
											scope.onBackgroundFailure(error, proposal.toolName),
									},
									proposal,
									batchSignal,
								),
							};
						} catch (error) {
							controller.abort(error);
							onFailure(error, proposal.toolName);
							throw error;
						}
					}),
				),
			);
			const failures = settled.flatMap((value) => (value.status === 'rejected' ? [value.reason] : []));
			if (failures.length === 1) {
				throw failures[0];
			}
			if (failures.length > 1) {
				const failure = aggregateToolFailures(failures, 'Tool batch failed after draining started calls');
				if (failures.every((error) => !isAgentDrainFailure(error))) {
					const first = failures[0];
					if (first instanceof AgentFailure) {
						throw new AgentFailure(first.code, { cause: failure });
					}
					if (first instanceof ToolOperationRefusal) {
						throw new ToolOperationRefusal(first.code, { cause: failure });
					}
				}
				throw failure;
			}
			for (const value of settled) {
				if (value.status === 'fulfilled' && value.value !== null) {
					results.push(value.value);
				}
			}
		}
		return results;
	}

	async execute(scope: ToolExecutionScope, proposal: RunToolProposal, signal: AbortSignal): Promise<string> {
		await this.drains.get(scope.runId);
		interrupted(signal);
		const release = this.model.activity(scope);
		try {
			return await this.executeOwned(scope, proposal, signal);
		} finally {
			release();
		}
	}

	private async executeOwned(
		scope: ToolExecutionScope,
		proposal: RunToolProposal,
		signal: AbortSignal,
	): Promise<string> {
		const configuration = await this.settings.frozen(scope.userId, scope.appId, scope.runId);
		const trusted = definition(proposal);
		let prepared: {
			input: Exclude<ToolInput, { kind: 'acp_integration' }>;
			target: ToolTarget | null;
			validateIntegration: () => Promise<void>;
		};
		try {
			prepared = await this.prepare(scope, trusted, proposal, signal);
		} catch (error) {
			if (!recoverableToolError(error) || signal.aborted) {
				throw error;
			}
			const rejected = await this.journal.inspect({
				id: randomUUID(),
				userId: scope.userId,
				appId: scope.appId,
				runId: scope.runId,
				modelStepIndex: scope.modelStepIndex,
				providerCallId: proposal.providerCallId,
				toolName: trusted.name,
				toolVersion: trusted.version,
				capability: trusted.capability,
				targetId: null,
				targetVersion: null,
				risk: trusted.risk,
				mutation: trusted.mutation,
				summary: trusted.description,
				argumentsJson: proposal.argumentsJson,
				expectedOperationRevision: null,
			});
			const settled = await this.journal.finish({
				identity: { userId: scope.userId, appId: scope.appId, runId: scope.runId, id: rejected.id },
				expectedRevision: rejected.revision,
				state: 'failed',
				resultText: JSON.stringify({ failureCode: runFailureCode(error, true) }),
			});
			interrupted(signal);
			if (settled.resultText === null) {
				throw new AgentFailure('internal_failure');
			}
			return projectCapturedResult(settled.id, settled.resultText, configuration.limits.maxToolOutputBytes);
		}
		const { input, target, validateIntegration } = prepared;
		let current = await this.journal.inspect({
			id: randomUUID(),
			userId: scope.userId,
			appId: scope.appId,
			runId: scope.runId,
			modelStepIndex: scope.modelStepIndex,
			providerCallId: proposal.providerCallId,
			toolName: trusted.name,
			toolVersion: trusted.version,
			capability: trusted.capability,
			targetId: target?.id ?? null,
			targetVersion: target?.version ?? null,
			risk:
				input.kind === 'docker_control' && input.items.some((item) => item.action === 'remove')
					? 'destructive'
					: input.kind === 'job' && input.action === 'cancel'
						? 'control'
						: trusted.risk,
			mutation: trusted.mutation || (input.kind === 'job' && input.action === 'cancel'),
			summary: inspectionSummary(input, trusted),
			argumentsJson: proposal.argumentsJson,
			expectedOperationRevision: null,
		});
		let taskSignal: AbortSignal | null = null;
		try {
			interrupted(signal);
			const admitted = current.mutation
				? await this.approve(current, target, signal)
				: await this.governance.toolAuthority(toolAuthorityIdentity(current), { kind: 'dispatch' });
			if (!admitted) {
				throw new AgentFailure('version_conflict');
			}
			current = admitted.operation;
			// Resumable Shell work is Run-owned. Its wait window must never abort execution.
			taskSignal =
				input.kind === 'image_generate' ||
				input.kind === 'shell' ||
				(input.kind === 'job' && input.action === 'wait')
					? signal
					: AbortSignal.any([signal, AbortSignal.timeout(configuration.limits.toolTimeoutSeconds * 1000)]);
			const result = await this.perform(
				input,
				target,
				current,
				admitted.policy.revision,
				taskSignal,
				configuration.limits,
				configuration.limits.maxToolOutputBytes,
				validateIntegration,
				{
					signal,
					deadlineAt: scope.deadlineAt,
					pluginCatalog: scope.pluginCatalog,
					availableDefinitions: scope.availableDefinitions,
					onBackgroundFailure: scope.onBackgroundFailure,
				},
			);
			interrupted(taskSignal);
			if (Buffer.byteLength(result.text, 'utf8') > TOOL_RESULT_MAX_BYTES) {
				throw new AgentFailure('limit_exceeded');
			}
			interrupted(signal);
			const completed = await this.governance.toolAuthority(toolAuthorityIdentity(current), {
				kind: 'complete',
				policyRevision: admitted.policy.revision,
				resultText: result.text,
				targets: result.targets,
			});
			if (!completed || completed.operation.resultText === null) {
				throw new AgentFailure('version_conflict');
			}
			current = completed.operation;
			if (input.kind === 'shell' && input.mode === 'background') {
				this.jobs.launch(current.id);
			}
			if (target) {
				await this.model.validateTarget(target);
			}
			await this.verify(current, admitted.policy.revision, signal);
			interrupted(signal);
			if (result.loadedTools) {
				scope.onToolsLoaded(result.loadedTools);
			}
			return projectCapturedResult(
				completed.operation.id,
				completed.operation.resultText,
				configuration.limits.maxToolOutputBytes,
			);
		} catch (error) {
			// Unknown commits and cleanup failures must not trigger a speculative second write.
			if (
				(isAgentDrainFailure(error) && !(error instanceof ToolExecutionUnknown)) ||
				current.state === 'completed'
			) {
				throw error;
			}
			const recoverable =
				recoverableToolError(error) &&
				!signal.aborted &&
				!taskSignal?.aborted &&
				(current.state === 'inspected' || !current.mutation);
			let settled: ToolOperation;
			try {
				settled = await this.journal.finish({
					identity: { userId: scope.userId, appId: scope.appId, runId: scope.runId, id: current.id },
					expectedRevision: current.revision,
					state:
						current.state === 'inspected' ||
						recoverable ||
						error instanceof ToolMutationAdmissionRefusal ||
						(input.kind === 'shell' && error instanceof ToolOperationRefusal)
							? 'failed'
							: 'unknown',
					resultText:
						error instanceof ToolBatchExecutionUnknown
							? error.resultText
							: JSON.stringify({
									failureCode: runFailureCode(
										error,
										true,
										taskSignal?.aborted === true && !signal.aborted,
									),
								}),
				});
			} catch (settlementError) {
				if (settlementError instanceof AgentFailure && settlementError.code === 'version_conflict') {
					throw error;
				}
				throw new AggregateError([error, settlementError], 'Tool execution and settlement failed');
			}
			if (recoverable) {
				interrupted(signal);
				if (settled.resultText === null) {
					throw new AgentFailure('internal_failure');
				}
				return projectCapturedResult(settled.id, settled.resultText, configuration.limits.maxToolOutputBytes);
			}
			throw error;
		}
	}

	private async prepare(
		scope: ToolExecutionScope,
		trusted: ToolDefinition,
		proposal: RunToolProposal,
		signal: AbortSignal,
	): Promise<{
		input: Exclude<ToolInput, { kind: 'acp_integration' }>;
		target: ToolTarget | null;
		validateIntegration: () => Promise<void>;
	}> {
		const contribution = scope.pluginCatalog.contribution;
		if (contribution?.toolNames && !contribution.toolNames.includes(trusted.name)) {
			throw new AgentFailure('forbidden');
		}
		await this.plugins.assertAgentCatalog(scope, scope.pluginCatalog.revision, signal);
		const requested = toolInput(trusted, proposal.argumentsJson);
		if (
			requested.kind === 'plugin' &&
			(requested.version !== scope.pluginCatalog.version ||
				requested.sha256 !== scope.pluginCatalog.sha256 ||
				!contribution?.tools.some((tool) => tool.name === requested.name))
		) {
			throw new AgentFailure('version_conflict');
		}

		const input =
			requested.kind === 'acp_integration' ? await this.integrations.acp(scope, requested.input) : requested;
		const validateConfiguration =
			requested.kind === 'acp_integration'
				? () => this.integrations.validateVersion(scope, requested.input.id, requested.input.version)
				: async () => {};

		const validateIntegration = async () => {
			await this.plugins.assertAgentCatalog(scope, scope.pluginCatalog.revision, signal);
			await validateConfiguration();
		};

		await validateIntegration();
		interrupted(signal);
		const target =
			input.kind === 'tool_search' ||
			input.kind === 'plugin' ||
			input.kind === 'browser_targets' ||
			input.kind === 'acp_integrations' ||
			input.kind === 'image_models' ||
			input.kind === 'image_generate' ||
			input.kind === 'skill' ||
			input.kind === 'browser' ||
			input.kind === 'mcp' ||
			input.kind === 'mcp_discovery' ||
			input.kind === 'host_diagnostics' ||
			input.kind === 'connections' ||
			input.kind === 'collaboration' ||
			input.kind === 'result' ||
			input.kind === 'memory' ||
			input.kind === 'artifact' ||
			input.kind === 'checkpoint'
				? null
				: await this.model.target(input.connectionId);
		interrupted(signal);
		return { input, target, validateIntegration };
	}

	private async approve(
		operation: ToolOperation,
		target: ToolTarget | null,
		signal: AbortSignal,
	): Promise<ToolAuthority> {
		const requested = await this.governance.request({
			id: randomUUID(),
			userId: operation.userId,
			appId: operation.appId,
			runId: operation.runId,
			toolCallId: operation.id,
			kind: 'tool',
		});
		if (!requested) {
			throw new AgentFailure('approval_stale');
		}
		const changes = this.governance.watch(operation.userId, operation.appId);
		try {
			while (true) {
				interrupted(signal);
				const valid = await this.governance.toolAuthority(toolAuthorityIdentity(operation), {
					kind: 'inspect',
					policyRevision: requested.policyRevision,
				});
				if (!valid) {
					throw new AgentFailure('approval_stale');
				}
				const approval = await this.governance.approval(operation.userId, operation.appId, requested.id);
				interrupted(signal);
				if (!approval || Date.now() >= approval.expiresAt * 1000) {
					throw new AgentFailure('approval_stale');
				}
				if (approval.status === 'approved') {
					if (target) {
						await this.model.validateTarget(target);
					}
					interrupted(signal);
					const dispatched = await this.governance.consume({
						userId: operation.userId,
						appId: operation.appId,
						approvalId: approval.id,
						expectedVersion: approval.version,
					});
					return {
						operation: dispatched,
						policy: valid.policy,
						connectionIds: valid.connectionIds.map((id) => id),
					};
				}
				if (approval.status !== 'requested') {
					throw new AgentFailure('approval_stale');
				}
				await changes.wait(signal);
			}
		} finally {
			changes.close();
		}
	}

	private async perform(
		input: Exclude<ToolInput, { kind: 'acp_integration' }>,
		target: ToolTarget | null,
		operation: ToolOperation,
		revision: number,
		signal: AbortSignal,
		limits: ExecutionLimits,
		previewBytes: number,
		validateIntegration: () => Promise<void>,
		run: {
			signal: AbortSignal;
			deadlineAt: number;
			pluginCatalog: PluginAgentCatalog;
			availableDefinitions: ToolDefinition[];
			onBackgroundFailure(error: unknown): void;
		},
	): Promise<{ text: string; targets: { id: number; version: number }[]; loadedTools?: string[] }> {
		const timeoutMs = limits.toolTimeoutSeconds * 1000;

		const validate = async () => {
			await validateIntegration();
			if (target) {
				await this.model.validateTarget(target);
			}
			await this.verify(operation, revision, signal);
			interrupted(signal);
		};

		await validate();
		if (input.kind === 'tool_search') {
			const catalog = await this.governance.toolCatalog(operation.userId, operation.appId, operation.runId);
			if (catalog === null) {
				throw new AgentFailure('version_conflict');
			}
			const available = authorizedToolDefinitions(run.availableDefinitions, catalog, run.pluginCatalog);
			const matches = searchToolDefinitions(available, input.query);
			await validate();
			return {
				text: JSON.stringify({
					matches: matches.map((tool) => ({
						name: tool.name,
						summary: tool.description.split(/(?<=[.!?])\s/u)[0],
					})),
					availableNextTurn: true,
				}),
				targets: [],
				loadedTools: matches.map((tool) => tool.name),
			};
		}
		if (input.kind === 'plugin') {
			await validate();
			const text = await this.plugins.invokeAgent(
				{ userId: operation.userId, appId: operation.appId },
				run.pluginCatalog,
				{
					kind: 'tool',
					runId: operation.runId,
					stepIndex: operation.modelStepIndex,
					operationId: operation.id,
					name: input.name,
					argumentsJson: input.argumentsJson,
				},
				signal,
				Math.max(1, Math.min(timeoutMs, run.deadlineAt - Date.now())),
			);
			await validate();
			return { text: JSON.stringify({ text, untrusted: true }), targets: [] };
		}

		if (input.kind === 'browser_targets') {
			const text = await this.browser.catalog(operation.userId, signal, validate);
			await validate();
			return { text, targets: [] };
		}
		if (input.kind === 'acp_integrations') {
			const catalog = await this.governance.toolCatalog(operation.userId, operation.appId, operation.runId);
			if (catalog === null) {
				throw new AgentFailure('version_conflict');
			}
			const text = await this.integrations.catalogAcp(
				{ userId: operation.userId, appId: operation.appId },
				catalog.connectionIds,
				signal,
				validate,
			);
			await validate();
			return { text, targets: [] };
		}
		if (input.kind === 'image_models') {
			const models = await this.providers.imageModels(operation.userId);
			await validate();
			return {
				text: JSON.stringify({
					models: models.slice(input.offset, input.offset + 20),
					nextOffset: input.offset + 20 < models.length ? input.offset + 20 : null,
				}),
				targets: [],
			};
		}
		if (input.kind === 'image_generate') {
			const result = await this.images.generate(
				{
					kind: 'tool',
					userId: operation.userId,
					appId: operation.appId,
					runId: operation.runId,
					operationId: operation.id,
					operationHash: operation.operationHash,
				},
				input.input,
				signal,
				validate,
			);
			return {
				text: JSON.stringify({ id: result.id, name: result.name, sizeBytes: result.sizeBytes }),
				targets: [],
			};
		}
		if (input.kind === 'skill') {
			const text = await this.plugins.performSkill(
				{ userId: operation.userId, appId: operation.appId },
				input.input,
				signal,
				validate,
			);
			await validate();
			return { text, targets: [] };
		}
		if (input.kind === 'mcp_discovery') {
			const text = await this.integrations.catalog(
				{ userId: operation.userId, appId: operation.appId, runId: operation.runId },
				input.input,
				signal,
				validate,
			);
			await validate();
			return { text, targets: [] };
		}
		if (input.kind === 'browser') {
			const text = await this.browser.perform(
				{
					userId: operation.userId,
					appId: operation.appId,
					runId: operation.runId,
					operationId: operation.id,
					operationHash: operation.operationHash,
				},
				input.input,
				signal,
				validate,
			);
			await validate();
			return { text, targets: [] };
		}
		if (input.kind === 'mcp') {
			const text = await this.integrations.invoke(
				{ userId: operation.userId, appId: operation.appId, runId: operation.runId },
				input.input,
				signal,
				validate,
			);
			await validate();
			return { text, targets: [] };
		}
		if (input.kind === 'host_diagnostics') {
			const text = await this.model.hostDiagnostics();
			await validate();
			return {
				text,
				targets: [],
			};
		}
		if (input.kind === 'checkpoint') {
			const value = await this.checkpoints.create(operation, input.summary);
			await validate();
			return {
				text: JSON.stringify({
					checkpointId: value.id,
					sourceHash: value.sourceHash,
					sourceMessages: value.sourceMessages,
				}),
				targets: [],
			};
		}
		if (input.kind === 'artifact') {
			const actor = {
				kind: 'tool' as const,
				userId: operation.userId,
				appId: operation.appId,
				runId: operation.runId,
				operationId: operation.id,
				operationHash: operation.operationHash,
			};
			let text: string;
			if (input.action === 'create') {
				const value = await this.artifacts.begin(actor, {
					name: input.name,
					mediaType: 'text/plain',
					declaredBytes: Buffer.byteLength(input.content, 'utf8'),
				});
				const content = input.content;

				async function* source(): AsyncIterable<Uint8Array> {
					yield Buffer.from(content, 'utf8');
				}

				const saved = await this.artifacts.upload(actor, value.id, value.version, source(), signal);
				text = JSON.stringify({
					id: saved.id,
					version: saved.version,
					status: saved.status,
					sizeBytes: saved.sizeBytes,
					sha256: saved.sha256,
				});
			} else if (input.action === 'present') {
				const items = [];
				let bytes = 128;
				for (const [index, artifactId] of input.artifactIds.entries()) {
					await validate();
					const saved = await this.artifacts.presentTool(actor, artifactId);
					const item = {
						index,
						status: 'completed',
						value: { id: saved.id, name: saved.name, sizeBytes: saved.sizeBytes },
					};
					const size = Buffer.byteLength(JSON.stringify(item)) + 1;
					if (bytes + size > TOOL_RESULT_MAX_BYTES) {
						break;
					}
					items.push(item);
					bytes += size;
				}
				text = JSON.stringify({
					items,
					nextIndex: items.length < input.artifactIds.length ? items.length : null,
				});
			} else {
				const page = await this.artifacts.readTool(
					actor,
					input.artifactId,
					input.offset,
					input.maxBytes,
					signal,
					input.encoding,
				);
				text = JSON.stringify({
					id: page.id,
					sha256: page.sha256,
					sizeBytes: page.sizeBytes,
					offset: page.offset,
					nextOffset: page.nextOffset,
					encoding: input.encoding,
					base64: page.base64,
					text: page.text,
					untrusted: true,
				});
			}
			await validate();
			return { text, targets: [] };
		}
		if (input.kind === 'memory') {
			const actor = {
				kind: 'tool' as const,
				userId: operation.userId,
				appId: operation.appId,
				runId: operation.runId,
				operationId: operation.id,
				operationHash: operation.operationHash,
			};
			let text: string;
			if (input.action === 'propose') {
				const saved = await this.memory.propose(actor, {
					content: input.content,
					confidence: 0.5,
					expiresAt: null,
					sourceRunId: operation.runId,
				});
				text = JSON.stringify({ id: saved.id, status: saved.status, version: saved.version });
			} else {
				const recalled = await this.memory.recall(actor, { query: input.query, limit: input.limit });
				text = JSON.stringify({
					items: recalled.map((item) => ({
						id: item.memory.id,
						version: item.memory.version,
						content: item.memory.content,
						confidence: item.memory.confidence,
						score: item.score,
					})),
					untrusted: true,
				});
			}
			await validate();
			return { text, targets: [] };
		}
		if (input.kind === 'result') {
			const items = [];
			const targets = new Map<number, { id: number; version: number }>();
			let bytes = 128;
			for (let index = 0; index < input.items.length; index++) {
				await validate();
				const result = await this.results.read(input.items[index], operation, revision, previewBytes);
				const page = result.page;
				const item = {
					index,
					toolCallId: page.toolCallId,
					sha256: page.sha256,
					originalBytes: page.originalBytes,
					offset: page.offset,
					nextOffset: page.nextOffset,
					text: page.text,
				};
				const size = Buffer.byteLength(JSON.stringify(item)) + 1;
				if (bytes + size > TOOL_RESULT_MAX_BYTES) {
					break;
				}
				items.push(item);
				bytes += size;
				for (const target of result.targets) {
					targets.set(target.id, { id: target.id, version: target.version });
				}
			}
			await validate();
			return {
				text: JSON.stringify({ items, nextIndex: items.length < input.items.length ? items.length : null }),
				targets: [...targets.values()],
			};
		}
		if (input.kind === 'collaboration') {
			return { text: await this.collaboration.perform(input.input, operation, signal, validate), targets: [] };
		}
		if (input.kind !== 'connections') {
			if (!target) {
				throw new AgentFailure('internal_failure');
			}

			if (input.kind === 'deliver') {
				const remote = this.model.remote(operation);
				const actor = {
					kind: 'tool' as const,
					userId: operation.userId,
					appId: operation.appId,
					runId: operation.runId,
					operationId: operation.id,
					operationHash: operation.operationHash,
				};
				const operationScope = {
					operationId: operation.id,
					target,
					signal,
					timeoutMs,

					validate: async () => {
						await this.model.validateTarget(target);
						await validate();
					},
				};
				const remaining = await this.artifacts.availableBytes(actor, 0);
				let total = 0;
				// Read-only preflight before creating any Artifact; importing revalidates each source.
				for (const path of input.paths) {
					const file = await remote.fileInfo(path, operationScope);
					total += file.sizeBytes;
					if (total > remaining) {
						throw new AgentFailure('limit_exceeded');
					}
				}
				if (
					Buffer.byteLength(
						JSON.stringify(
							input.paths.map((path, index) => ({
								index,
								status: 'completed',
								value: {
									id: 'f'.repeat(36),
									name: path,
									sizeBytes: Number.MAX_SAFE_INTEGER,
									sha256: 'f'.repeat(64),
								},
							})),
						),
					) +
						128 >
					TOOL_RESULT_MAX_BYTES
				) {
					throw new AgentFailure('limit_exceeded');
				}
				const items: Array<{
					index: number;
					status: string;
					value?: { id: string; name: string; sizeBytes: number; sha256: string | null };
					failureCode?: string;
				}> = [];
				for (let index = 0; index < input.paths.length; index++) {
					try {
						await validate();
						const saved = await remote.consumeFile(
							input.paths[index],
							await this.artifacts.availableBytes(actor, 0),
							operationScope,
							(file, source) =>
								this.artifacts.importTool(actor, file.name, file.sizeBytes, source, signal),
						);
						items.push({
							index,
							status: 'completed',
							value: { id: saved.id, name: saved.name, sizeBytes: saved.sizeBytes, sha256: saved.sha256 },
						});
					} catch (error) {
						const known = error instanceof AgentFailure && !isAgentDrainFailure(error);
						items.push({
							index,
							status: known ? 'failed' : 'unknown',
							failureCode: runFailureCode(error, true),
						});
						for (let later = index + 1; later < input.paths.length; later++) {
							items.push({ index: later, status: 'not_started' });
						}
						if (!known) {
							if (error instanceof ToolExecutionUnknown && !(error instanceof ToolCleanupFailure)) {
								throw new ToolBatchExecutionUnknown(JSON.stringify({ items }), error);
							}
							throw error;
						}
						break;
					}
				}
				await validate();
				return { text: JSON.stringify({ items }), targets: [{ id: target.id, version: target.version }] };
			}

			if (input.kind === 'project') {
				return {
					text: await this.projects.perform(input.input, operation, target, revision, signal, validate),
					targets: [{ id: target.id, version: target.version }],
				};
			}

			if (input.kind === 'acp') {
				const remote = this.model.remote(operation);
				const text = await this.acp.execute(
					operation,
					target,
					revision,
					signal,
					timeoutMs,
					async (taskSignal) => {
						await this.model.validateTarget(target);
						await validateIntegration();
						await this.verify(operation, revision, taskSignal);
					},
					(taskSignal, permission, timeoutMs) =>
						remote.perform(input, {
							operationId: operation.id,
							target,
							signal: taskSignal,

							validate: async () => {
								await this.model.validateTarget(target);
								await this.verify(operation, revision, taskSignal);
							},

							timeoutMs,
							permission,
						}),
				);
				return { text, targets: [{ id: target.id, version: target.version }] };
			}
			if (input.kind === 'job') {
				const text = await this.jobs.control(
					{ userId: operation.userId, appId: operation.appId, runId: operation.runId },
					target,
					{
						action: input.action,
						jobIds: input.jobIds.map((id) => id),
						waitMode: input.waitMode,
						waitSeconds: input.waitSeconds,
						offset: input.offset,
					},
					signal,
					validate,
					timeoutMs,
				);
				return { text, targets: [{ id: target.id, version: target.version }] };
			}
			if (input.kind === 'shell') {
				const remote = this.model.remote(operation);

				const jobValidate = async (jobSignal: AbortSignal) => {
					const current = await this.journal.get({
						userId: operation.userId,
						appId: operation.appId,
						runId: operation.runId,
						id: operation.id,
					});
					if (!current || current.operationHash !== operation.operationHash) {
						throw new AgentFailure('version_conflict');
					}
					await this.model.validateTarget(target);
					await this.verifyJob(current, revision, jobSignal);
				};

				const text = await this.jobs.prepare({
					background: input.mode === 'background',
					operation,
					target,
					policyRevision: revision,
					// Every yield keeps the original absolute Run deadline.
					signal: run.signal,
					deadlineAt: run.deadlineAt,
					maxHistory: limits.maxToolExecutions,
					onFailure: run.onBackgroundFailure,

					work: (jobSignal, timeoutMs, onOutput) =>
						remote.command(
							input,
							{
								operationId: operation.id,
								target,
								signal: jobSignal,

								validate: () => jobValidate(jobSignal),

								timeoutMs,
							},
							onOutput,
						),

					validate: jobValidate,
				});
				if (input.mode === 'foreground') {
					this.jobs.launch(operation.id);
					return {
						text: await this.jobs.foreground(
							{ userId: operation.userId, appId: operation.appId, runId: operation.runId },
							target,
							operation.id,
							Math.min(input.yieldSeconds ?? limits.toolTimeoutSeconds, limits.toolTimeoutSeconds) * 1000,
							signal,
							validate,
						),
						targets: [{ id: target.id, version: target.version }],
					};
				}
				return { text, targets: [{ id: target.id, version: target.version }] };
			}
			const text = await this.model.remote(operation).perform(input, {
				operationId: operation.id,
				target,
				signal,
				validate,
				timeoutMs,
			});
			await validate();
			return { text, targets: [{ id: target.id, version: target.version }] };
		}
		const before = await this.verify(operation, revision, signal);
		const entries = await this.model.connections(
			before.connectionIds.filter((id) => authorizationFact(before.policy, 'machine.inspect', id).allowed),
		);
		const after = await this.verify(operation, revision, signal);
		const selected = new Set(after.connectionIds);
		const connections = entries.filter(
			(entry) =>
				entry.type === 'SSH' &&
				selected.has(entry.id) &&
				authorizationFact(after.policy, 'machine.inspect', entry.id).allowed,
		);
		return {
			text: JSON.stringify({
				connections: connections.map((entry) => ({
					id: entry.id,
					name: entry.name,
					host: entry.host,
					port: entry.port,
					username: entry.username,
				})),
			}),
			targets: connections.map((entry) => ({ id: entry.id, version: entry.version })),
		};
	}

	resource(scope: ToolJobScope): import('../model/tool-resource-types.js').ToolResourceSnapshot | null {
		const value = this.model.resource(scope);
		if (value === null) {
			return null;
		}
		return {
			id: value.id,
			runId: value.runId,
			phase: value.phase,
			createdAt: value.createdAt,
			lastUsedAt: value.lastUsedAt,
			connections: value.connections,
			files: value.files,
			operations: value.operations,
			targets: value.targets.map((id) => id),
			mcpSessions: this.integrations.sessionCount(scope),
			browserSessions: this.browser.sessionCount(scope),
		};
	}

	backgroundCount(scope: ToolJobScope): number {
		return this.jobs.backgroundCount(scope);
	}

	closeResource(scope: ToolJobScope, id: string): Promise<void> {
		return this.resource(scope)?.id === id ? this.drainRun(scope) : Promise.resolve();
	}

	scopes(userId: number, appId: string): ToolJobScope[] {
		return this.model.scopes(userId, appId);
	}

	drainRun(scope: ToolJobScope): Promise<void> {
		const current = this.drains.get(scope.runId);
		if (current) {
			return current;
		}
		this.model.quiesceRun(scope);
		const pending = Promise.resolve().then(() => this.drainOwned(scope));
		this.drains.set(scope.runId, pending);
		void pending.then(
			() => {
				if (this.drains.get(scope.runId) === pending) {
					this.drains.delete(scope.runId);
				}
			},
			() => {},
		);
		return pending;
	}

	private async drainOwned(scope: ToolJobScope): Promise<void> {
		const results = await Promise.allSettled([
			Promise.resolve().then(() => this.integrations.drainRun(scope)),
			Promise.resolve().then(() => this.jobs.drain(scope)),
			Promise.resolve().then(() => this.browser.drainRun(scope)),
		]);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		try {
			await this.model.drainRun(scope.runId);
		} catch (error) {
			failures.push(error);
		}
		this.model.settleDrain(scope, failures.length > 0);
		if (failures.length) {
			throw aggregateToolFailures(failures, 'Tool resources failed to drain');
		}
	}

	private async verifyJob(operation: ToolOperation, policyRevision: number, signal: AbortSignal): Promise<void> {
		try {
			await this.verify(operation, policyRevision, signal);
		} catch (error) {
			if (
				!(error instanceof AgentFailure) ||
				error.code !== 'version_conflict' ||
				operation.state !== 'dispatched'
			) {
				throw error;
			}
			const delivered = await this.journal.get({
				userId: operation.userId,
				appId: operation.appId,
				runId: operation.runId,
				id: operation.id,
			});
			if (
				!delivered ||
				delivered.state !== 'completed' ||
				delivered.revision !== operation.revision + 1 ||
				delivered.operationHash !== operation.operationHash
			) {
				throw error;
			}
			// Foreground delivery advances the tool revision while this Job stays active.
			// Revalidate that one known transition; policy, target and approval still must pass.
			await this.verify(delivered, policyRevision, signal);
		}
	}

	private async verify(
		operation: ToolOperation,
		policyRevision: number,
		signal: AbortSignal,
	): Promise<ToolAuthority> {
		interrupted(signal);
		const permit = await this.governance.toolAuthority(toolAuthorityIdentity(operation), {
			kind: 'verify',
			policyRevision,
		});
		interrupted(signal);
		if (!permit) {
			throw new AgentFailure('version_conflict');
		}
		return permit;
	}
}
