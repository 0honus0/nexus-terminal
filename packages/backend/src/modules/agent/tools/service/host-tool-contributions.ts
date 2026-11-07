import type { ToolContentService } from './tool-content-service.js';
import type { ToolRemoteService } from './tool-remote-service.js';
import type { ToolJobService } from './tool-job-service.js';
import type { RunCollaborationService } from '../../runs/service/run-collaboration-service.js';
import type { BrowserService } from '../../integrations/service/browser-service.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import type { ToolModel } from '../model/tool-model.js';
import type {
	HostEffectContribution,
	PreparedHostEffect,
	HostPreparationScope,
	HostEffectContext,
	HostMetadataContext,
} from '../model/host-execution-types.js';
import type { AgentPluginHostOperationRequest } from '@nexus-terminal/shared/agent/plugins/host-operations';
import type { HostOperationDefinition, ToolTarget } from '../model/tool-types.js';
import type { HostOperationResult } from '../model/host-operation-result.js';
import { cloneHostOperationResult } from '../model/host-operation-result.js';
import type { HostToolCommand } from '../model/host-tool-command.js';
import { hostOperationCommand, hostOperationRequest } from './host-operation-input.js';
import { hostOperationSummary } from './host-operation-summary.js';
import { hostOperationDefinitions, effectiveHostOperationPolicy } from '../host-operation-rules.js';
import { authorizationFact } from '../../governance/governance-rules.js';
import { AgentFailure } from '../../agent-failure.js';
import { hostRemoteFileContributions } from './host-remote-file-contributions.js';

type HostInput = Exclude<HostToolCommand, { kind: 'discovery_catalog' | 'discovery_activate' }>;
type HostHandlerResult = HostOperationResult & {
	targets: { id: number; version: number }[];
	outputArtifactIds?: string[];
};
type HostHandler = (
	input: HostInput,
	target: ToolTarget | null,
	context: HostEffectContext,
) => Promise<HostHandlerResult>;

/** Governed resource operations have no model-facing schema or prompt text. */
export class HostToolContributions {
	private readonly handlers: Record<HostInput['kind'], HostHandler>;

	constructor(
		private readonly model: ToolModel,
		private readonly jobs: ToolJobService,
		private readonly content: ToolContentService,
		remote: ToolRemoteService,
		collaboration: RunCollaborationService,
		private readonly browser: BrowserService,
		private readonly plugins: PluginService,
	) {
		const contentHandler: HostHandler = async (input, _target, context) => {
			if (
				input.kind !== 'image_models' &&
				input.kind !== 'image_generate' &&
				input.kind !== 'artifact' &&
				input.kind !== 'memory' &&
				input.kind !== 'result'
			) {
				throw new AgentFailure('internal_failure');
			}
			return content.perform(
				input,
				context.operation,
				context.revision,
				context.signal,
				context.limits.maxToolOutputBytes,
				context.validate,
				context.recordOutputArtifacts,
			);
		};

		const remoteHandler: HostHandler = async (input, target, context) => {
			if (!target || !('connectionId' in input)) {
				throw new AgentFailure('internal_failure');
			}
			return remote.perform(input, target, context);
		};

		this.handlers = {
			image_models: contentHandler,
			image_generate: contentHandler,
			artifact: contentHandler,
			memory: contentHandler,
			result: contentHandler,
			shell: remoteHandler,
			job: remoteHandler,
			project: remoteHandler,
			diagnostics: remoteHandler,
			docker_inspect: remoteHandler,
			docker_control: remoteHandler,
			deliver: remoteHandler,
			inspect: remoteHandler,
			patch: remoteHandler,
			move: remoteHandler,
			delete: remoteHandler,
			write: remoteHandler,
			search: remoteHandler,

			browser_targets: async (_input, _target, context) => ({
				operation: 'browser.catalog',
				value: await browser.catalog(context.operation.userId, context.signal, context.validate),

				targets: [],
			}),

			skill: async (input, _target, context) => {
				if (input.kind !== 'skill') {
					throw new AgentFailure('internal_failure');
				}
				return {
					...(await plugins.performSkill(
						{ userId: context.operation.userId, appId: context.operation.appId },
						input.input,
						context.signal,
						context.validate,
					)),

					targets: [],
				};
			},

			browser: async (input, _target, context) => {
				if (input.kind !== 'browser') {
					throw new AgentFailure('internal_failure');
				}
				const operation = context.operation;
				const result = await browser.perform(
					{
						userId: operation.userId,
						appId: operation.appId,
						runId: operation.runId,
						operationId: operation.id,
						operationHash: operation.operationHash,
					},
					input.input,
					context.signal,
					context.validate,
					context.recordOutputArtifacts,
				);
				if (result.action !== input.input.action) {
					throw new AgentFailure('internal_failure');
				}
				switch (result.action) {
					case 'open':
						return { operation: 'browser.open', value: result.value, targets: [] };
					case 'close':
						return { operation: 'browser.close', value: result.value, targets: [] };
					case 'snapshot':
						return { operation: 'browser.snapshot', value: result.value, targets: [] };
					case 'screenshot':
						return {
							operation: 'browser.screenshot',
							value: result.value,
							targets: [],
							outputArtifactIds: [result.value.artifactId],
						};
					case 'download':
						return {
							operation: 'browser.download',
							value: result.value,
							targets: [],
							outputArtifactIds: [result.value.artifactId],
						};
					case 'console':
						return { operation: 'browser.console', value: result.value, targets: [] };
					case 'navigate':
						return { operation: 'browser.navigate', value: result.value, targets: [] };
					case 'back':
						return { operation: 'browser.back', value: result.value, targets: [] };
					case 'scroll':
						return { operation: 'browser.scroll', value: result.value, targets: [] };
					case 'press':
						return { operation: 'browser.press', value: result.value, targets: [] };
					case 'select':
						return { operation: 'browser.select', value: result.value, targets: [] };
					case 'wait':
						return { operation: 'browser.wait', value: result.value, targets: [] };
					case 'click':
						return { operation: 'browser.click', value: result.value, targets: [] };
					case 'type':
						return { operation: 'browser.type', value: result.value, targets: [] };
					case 'upload':
						return { operation: 'browser.upload', value: result.value, targets: [] };
				}
			},

			host_diagnostics: async () => ({
				operation: 'diagnostics.host',
				value: await model.hostDiagnostics(),
				targets: [],
			}),

			collaboration: async (input, _target, context) => {
				if (input.kind !== 'collaboration') {
					throw new AgentFailure('internal_failure');
				}
				return {
					...(await collaboration.perform(
						input.input,
						context.operation,
						context.signal,
						context.validate,
						await context.availableTools(),
					)),

					targets: [],
				};
			},

			connections: async (_input, _target, context) => {
				const before = await context.verify(context.signal);
				const entries = await model.connections(
					before.connectionIds.filter(
						(id) => authorizationFact(before.policy, 'machine.inspect', id).allowed,
					),
				);
				const after = await context.verify(context.signal);
				const selected = new Set(after.connectionIds);
				const connections = entries.filter(
					(entry) =>
						entry.type === 'SSH' &&
						selected.has(entry.id) &&
						authorizationFact(after.policy, 'machine.inspect', entry.id).allowed,
				);
				return {
					operation: 'targets.list',
					value: {
						connections: connections.map((entry) => ({
							id: entry.id,
							name: entry.name,
							host: entry.host,
							port: entry.port,
							username: entry.username,
						})),
					},
					targets: connections.map((entry) => ({ id: entry.id, version: entry.version })),
				};
			},
		};
	}

	/** These reads have no external effect or durable execution identity. */
	isMetadata(name: string): boolean {
		return [
			'targets.list',
			'diagnostics.host',
			'skills.catalog',
			'skills.read',
			'images.list',
			'browser.catalog',
		].includes(name);
	}

	async metadata(
		command: AgentPluginHostOperationRequest,
		context: HostMetadataContext,
	): Promise<HostOperationResult> {
		await context.verify();
		let result: HostOperationResult;
		switch (command.operation) {
			case 'images.list':
				result = await this.content.imageModels(context.userId);
				break;
			case 'diagnostics.host':
				result = { operation: command.operation, value: await this.model.hostDiagnostics() };
				break;
			case 'browser.catalog':
				result = {
					operation: command.operation,
					value: await this.browser.catalog(context.userId, context.signal, async () => {
						await context.verify();
					}),
				};
				break;
			case 'skills.catalog':
			case 'skills.read': {
				const input = hostOperationCommand(command);
				if (input.kind !== 'skill') {
					throw new AgentFailure('internal_failure');
				}
				result = await this.plugins.performSkill(
					{ userId: context.userId, appId: context.appId },
					input.input,
					context.signal,
					async () => {
						await context.verify();
					},
				);
				break;
			}
			case 'targets.list': {
				const before = await context.verify();
				const entries = await this.model.connections(
					before.connectionIds.filter(
						(id) => authorizationFact(before.policy, 'machine.inspect', id).allowed,
					),
				);
				const after = await context.verify();
				const selected = new Set(after.connectionIds);
				result = {
					operation: command.operation,
					value: {
						connections: entries
							.filter(
								(entry) =>
									entry.type === 'SSH' &&
									selected.has(entry.id) &&
									authorizationFact(after.policy, 'machine.inspect', entry.id).allowed,
							)
							.map((entry) => ({
								id: entry.id,
								name: entry.name,
								host: entry.host,
								port: entry.port,
								username: entry.username,
							})),
					},
				};
				break;
			}
			default:
				throw new AgentFailure('forbidden');
		}
		await context.verify();
		return cloneHostOperationResult(result);
	}

	contributions(): HostEffectContribution[] {
		return [
			...hostOperationDefinitions()
				.filter(
					(definition) =>
						definition.name !== 'remote.readTextPage' &&
						definition.name !== 'remote.listPage' &&
						!['discovery.catalog', 'discovery.activate'].includes(definition.name),
				)
				.map((definition): HostEffectContribution => ({
					definition,

					prepare: (argumentsJson, scope, signal) => this.prepare(definition, argumentsJson, scope, signal),
				})),
			...hostRemoteFileContributions(this.model),
		];
	}

	private async prepare(
		definition: HostOperationDefinition,
		argumentsJson: string,
		scope: HostPreparationScope,
		signal: AbortSignal,
	): Promise<PreparedHostEffect> {
		const input = hostOperationCommand(hostOperationRequest(definition.name, argumentsJson));
		if (input.kind === 'discovery_catalog' || input.kind === 'discovery_activate') {
			throw new AgentFailure('invalid_input');
		}
		const effective = effectiveHostOperationPolicy(definition.name, argumentsJson);
		if (!effective) {
			throw new AgentFailure('invalid_input');
		}

		const target = 'connectionId' in input ? await this.model.target(input.connectionId) : null;
		const handler = this.handlers[input.kind];
		const prepared: PreparedHostEffect = {
			target,
			summary: hostOperationSummary(input, definition),
			risk: effective.risk,
			mutation: effective.mutation,
			lifetime:
				input.kind === 'image_generate' ||
				input.kind === 'shell' ||
				(input.kind === 'job' && input.action === 'wait')
					? 'run'
					: 'operation',
			refusalIsDefinite: input.kind === 'shell',

			validate: async () => {
				if (target) {
					await this.model.validateTarget(target);
				}
			},

			execute: async (context) => {
				const result = await handler(input, target, context);
				if (result.outputArtifactIds?.length) {
					context.recordOutputArtifacts(result.outputArtifactIds);
				}
				const hostResult: HostOperationResult = cloneHostOperationResult(result);
				if (hostResult.operation !== definition.name) {
					throw new AgentFailure('internal_failure');
				}
				await context.validate();
				return {
					text: JSON.stringify(hostResult),
					hostResult,
					targets: result.targets,
					outputArtifactIds: result.outputArtifactIds,
				};
			},
		};
		if (input.kind === 'shell' && input.mode === 'background') {
			prepared.afterCommit = (operation) => this.jobs.launch(operation.id);
		}
		return prepared;
	}
}
