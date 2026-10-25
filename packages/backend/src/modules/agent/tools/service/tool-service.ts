import type { ProviderService } from '../../providers/service/provider-service.js';
import type { ProviderImageService } from '../../providers/service/provider-image-service.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import type { BrowserService } from '../../integrations/service/browser-service.js';
import type { IntegrationService } from '../../integrations/service/integration-service.js';
import type { CheckpointService } from '../../context/service/checkpoint-service.js';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { MemoryService } from '../../memory/service/memory-service.js';
import { toolAuthorityIdentity } from '../../governance/governance-rules.js';
import type { ToolProjectService } from './tool-project-service.js';
import type { ResultService } from '../../context/service/result-service.js';
import { projectCapturedResult } from '../../context/result-rules.js';
import type { RunCollaborationService } from '../../runs/service/run-collaboration-service.js';
import type { AcpPermissionService } from './acp-permission-service.js';
import type { ToolJobService } from './tool-job-service.js';
import type { ToolJobScope } from '../model/tool-job-types.js';
import { setTimeout as delay } from 'node:timers/promises';
import { AGENT_APPROVAL_MAX_SUMMARY_BYTES } from '@nexus-terminal/shared/agent/governance/values';
import { createHash, randomUUID } from 'node:crypto';
import type { ToolModel } from '../model/tool-model.js';
import type { RunToolModel } from '../../runs/model/run-tool-model.js';
import type { RunToolProposal } from '../../runs/model/run-types.js';
import type { ToolOperation } from '../../runs/model/run-tool-types.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { ToolAuthority } from '../../governance/model/governance-types.js';
import type { ToolInput, ToolDefinition, ToolTarget } from '../model/tool-types.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import { toolDefinitions } from './tool-definitions.js';
import { toolInput } from './tool-input.js';
import { AgentFailure, ToolExecutionUnknown, isAgentDrainFailure, aggregateToolFailures } from '../../agent-failure.js';
import { TOOL_RESULT_MAX_BYTES } from '../../runs/run-tool-limits.js';

function interrupted(signal: AbortSignal): void {
	if (signal.aborted) {
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

function inspectionSummary(input: ToolInput, trusted: ToolDefinition): string {
	const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

	let summary: string;
	if (input.kind === 'image_generate') {
		summary = JSON.stringify({
			action: 'image_generate',
			providerId: input.input.providerId,
			configurationVersion: input.input.configurationVersion,
			modelId: input.input.modelId,
			promptBytes: Buffer.byteLength(input.input.prompt),
			promptSha256: hash(input.input.prompt),
		});
	} else if (input.kind === 'acp') {
		summary = JSON.stringify({
			action: 'acp_execute',
			cwd: input.cwd,
			argvSha256: hash(JSON.stringify(input.argv)),
			promptBytes: Buffer.byteLength(input.prompt, 'utf8'),
			promptSha256: hash(input.prompt),
		});
	} else if (input.kind === 'shell') {
		const command = input.command.kind === 'argv' ? JSON.stringify(input.command.argv) : input.command.script;
		summary = JSON.stringify({
			action: 'execute',
			mode: input.mode,
			kind: input.command.kind,
			cwd: input.cwd,
			bytes: Buffer.byteLength(command, 'utf8'),
			sha256: hash(command),
		});
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
	} else if (input.kind === 'job') {
		summary = JSON.stringify({ action: input.action, jobId: input.jobId });
	} else if (input.kind === 'docker_control') {
		summary = JSON.stringify({
			action: input.action,
			containerId: input.containerId,
			expectedFingerprint: input.expectedFingerprint,
		});
	} else if (input.kind === 'write') {
		summary = JSON.stringify({
			action: input.expectedSha256 === 'absent' ? 'create' : 'replace',
			path: input.path,
			bytes: Buffer.byteLength(input.content, 'utf8'),
			sha256: hash(input.content),
			expectedSha256: input.expectedSha256,
		});
	} else if (input.kind === 'patch') {
		summary = JSON.stringify({
			action: 'patch',
			path: input.path,
			expectedSha256: input.expectedSha256,
			oldBytes: Buffer.byteLength(input.oldText, 'utf8'),
			oldSha256: hash(input.oldText),
			newBytes: Buffer.byteLength(input.newText, 'utf8'),
			newSha256: hash(input.newText),
		});
	} else if (input.kind === 'move') {
		summary = JSON.stringify({
			action: 'move',
			path: input.path,
			destinationPath: input.destinationPath,
			expectedFingerprint: input.expectedFingerprint,
		});
	} else if (input.kind === 'delete') {
		summary = JSON.stringify({
			action: 'delete',
			path: input.path,
			scope: input.scope,
			expectedFingerprint: input.expectedFingerprint,
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

	validate(proposal: RunToolProposal): void {
		toolInput(definition(proposal), proposal.argumentsJson);
	}

	async execute(
		scope: { userId: number; appId: string; runId: string; modelStepIndex: number },
		proposal: RunToolProposal,
		signal: AbortSignal,
	): Promise<string> {
		const configuration = await this.settings.frozen(scope.userId, scope.appId, scope.runId);
		const trusted = definition(proposal);
		const requested = toolInput(trusted, proposal.argumentsJson);
		const input =
			requested.kind === 'acp_integration' ? await this.integrations.acp(scope, requested.input) : requested;
		const validateIntegration =
			requested.kind === 'acp_integration'
				? () => this.integrations.validateVersion(scope, requested.input.id, requested.input.version)
				: async () => {};
		await validateIntegration();
		interrupted(signal);
		const target =
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
				input.kind === 'docker_control' && input.action === 'remove'
					? 'destructive'
					: input.kind === 'job' && input.action === 'cancel'
						? 'control'
						: trusted.risk,
			mutation: trusted.mutation || (input.kind === 'job' && input.action === 'cancel'),
			summary: inspectionSummary(input, trusted),
			argumentsJson: proposal.argumentsJson,
			expectedOperationRevision: null,
		});
		try {
			interrupted(signal);
			const admitted = current.mutation
				? await this.approve(current, target, signal)
				: await this.governance.toolAuthority(toolAuthorityIdentity(current), { kind: 'dispatch' });
			if (!admitted) {
				throw new AgentFailure('version_conflict');
			}
			current = admitted.operation;
			const taskSignal = AbortSignal.any([
				signal,
				AbortSignal.timeout(configuration.limits.toolTimeoutSeconds * 1000),
			]);
			const result = await this.perform(
				input,
				target,
				current,
				admitted.policy.revision,
				taskSignal,
				configuration.limits.toolTimeoutSeconds * 1000,
				validateIntegration,
				signal,
			);
			interrupted(taskSignal);
			if (
				Buffer.byteLength(result.text, 'utf8') >
				Math.min(TOOL_RESULT_MAX_BYTES, configuration.limits.maxToolOutputBytes)
			) {
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
			return projectCapturedResult(completed.operation.id, completed.operation.resultText);
		} catch (error) {
			// Unknown commits and cleanup failures must not trigger a speculative second write.
			if (
				(isAgentDrainFailure(error) && !(error instanceof ToolExecutionUnknown)) ||
				current.state === 'completed'
			) {
				throw error;
			}
			try {
				await this.journal.finish({
					identity: { userId: scope.userId, appId: scope.appId, runId: scope.runId, id: current.id },
					expectedRevision: current.revision,
					state: current.state === 'inspected' ? 'failed' : 'unknown',
					resultText: null,
				});
			} catch (settlementError) {
				if (settlementError instanceof AgentFailure && settlementError.code === 'version_conflict') {
					throw error;
				}
				throw new AggregateError([error, settlementError], 'Tool execution and settlement failed');
			}
			throw error;
		}
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
			await this.wait(signal);
		}
	}

	private async wait(signal: AbortSignal): Promise<void> {
		try {
			await delay(1000, undefined, { signal });
		} catch (error) {
			interrupted(signal);
			throw error;
		}
	}

	private async perform(
		input: Exclude<ToolInput, { kind: 'acp_integration' }>,
		target: ToolTarget | null,
		operation: ToolOperation,
		revision: number,
		signal: AbortSignal,
		timeoutMs: number,
		validateIntegration: () => Promise<void>,
		runSignal: AbortSignal,
	): Promise<{ text: string; targets: { id: number; version: number }[] }> {
		const validate = async () => {
			await validateIntegration();
			if (target) {
				await this.model.validateTarget(target);
			}
			await this.verify(operation, revision, signal);
			interrupted(signal);
		};

		await validate();
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
			return { text: JSON.stringify(result), targets: [] };
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
				{ userId: operation.userId, appId: operation.appId },
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
			} else {
				const page = await this.artifacts.readTool(
					actor,
					input.artifactId,
					input.offset,
					input.maxBytes,
					signal,
				);
				text = JSON.stringify({
					id: page.id,
					sha256: page.sha256,
					sizeBytes: page.sizeBytes,
					offset: page.offset,
					nextOffset: page.nextOffset,
					base64: page.base64,
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
			const result = await this.results.read(input.input, operation, revision);
			await validate();
			return {
				text: JSON.stringify({
					toolCallId: result.page.toolCallId,
					sha256: result.page.sha256,
					originalBytes: result.page.originalBytes,
					offset: result.page.offset,
					nextOffset: result.page.nextOffset,
					text: result.page.text,
				}),
				targets: result.targets.map((target) => ({ id: target.id, version: target.version })),
			};
		}
		if (input.kind === 'collaboration') {
			return { text: await this.collaboration.perform(input.input, operation, signal, validate), targets: [] };
		}
		if (input.kind !== 'connections') {
			if (!target) {
				throw new AgentFailure('internal_failure');
			}

			if (input.kind === 'project') {
				return {
					text: await this.projects.perform(input.input, operation, target, revision, signal, validate),
					targets: [{ id: target.id, version: target.version }],
				};
			}

			if (input.kind === 'acp') {
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
						this.model.perform(input, {
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
					{ action: input.action, jobId: input.jobId, waitSeconds: input.waitSeconds },
					signal,
					validate,
				);
				return { text, targets: [{ id: target.id, version: target.version }] };
			}
			if (input.kind === 'shell' && input.mode === 'background') {
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
					await this.verify(current, revision, jobSignal);
				};

				const text = await this.jobs.prepare({
					operation,
					target,
					policyRevision: revision,
					// The accepted background Job belongs to the Run, not to the
					// completed shell_execute invocation's tool timeout signal. The
					// JobService owns its independent bounded deadline and Root drain.
					signal: runSignal,
					timeoutMs,

					work: (jobSignal, timeoutMs) =>
						this.model.command(input, {
							operationId: operation.id,
							target,
							signal: jobSignal,

							validate: () => jobValidate(jobSignal),

							timeoutMs,
						}),

					validate: jobValidate,
				});
				return { text, targets: [{ id: target.id, version: target.version }] };
			}
			const text = await this.model.perform(input, {
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
			before.connectionIds.filter((id) => !before.policy.app.deniedTargetIds.includes(id)),
		);
		const after = await this.verify(operation, revision, signal);
		const selected = new Set(after.connectionIds);
		const denied = new Set(after.policy.app.deniedTargetIds);
		const connections = entries.filter(
			(entry) => entry.type === 'SSH' && selected.has(entry.id) && !denied.has(entry.id),
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
			targets: entries.map((entry) => ({ id: entry.id, version: entry.version })),
		};
	}

	async drainRun(scope: ToolJobScope): Promise<void> {
		const results = await Promise.allSettled([
			Promise.resolve().then(() => this.integrations.drainRun(scope)),
			Promise.resolve().then(() => this.jobs.drain(scope)),
			Promise.resolve().then(() => this.browser.drainRun(scope)),
		]);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			throw aggregateToolFailures(failures, 'Tool resources failed to drain');
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
