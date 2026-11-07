import type { ToolRemoteInput } from '../model/tool-perform-types.js';
import { posix } from 'node:path';
import type { HostEffectContext } from '../model/host-execution-types.js';
import type { ToolDeliveryItem } from '../model/tool-domain-types.js';
import type { HostOperationResult } from '../model/host-operation-result.js';
import type { ToolTarget } from '../model/tool-types.js';
import type { ToolModel } from '../model/tool-model.js';
import type { ToolJobService } from './tool-job-service.js';
import type { ToolProjectService } from './tool-project-service.js';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import { ToolBatchExecutionUnknown, ToolBatchCleanupFailure } from '../model/tool-batch-failure.js';
import { AgentFailure, ToolExecutionUnknown, ToolCleanupFailure, isAgentDrainFailure } from '../../agent-failure.js';
import { runFailureCode } from '../../runs/run-failure-rules.js';
import { TOOL_RESULT_MAX_BYTES } from '../../runs/run-tool-limits.js';

type ToolRemoteResult = Extract<
	HostOperationResult,
	{
		operation:
			| 'project.bindingRead'
			| 'project.bindingWrite'
			| 'remote.deliver'
			| 'shell.execute'
			| 'shell.jobs'
			| 'docker.inspect'
			| 'docker.control'
			| 'remote.write'
			| 'remote.move'
			| 'remote.delete'
			| 'remote.patch'
			| 'remote.inspect'
			| 'remote.search'
			| 'diagnostics.readTarget';
	}
> & { targets: { id: number; version: number }[]; outputArtifactIds?: string[] };

/** Remote dispatch and yielded Jobs use the original Run lifetime and current authority. */
export class ToolRemoteService {
	constructor(
		private readonly model: ToolModel,
		private readonly jobs: ToolJobService,
		private readonly projects: ToolProjectService,
		private readonly artifacts: ArtifactService,
	) {}

	async perform(input: ToolRemoteInput, target: ToolTarget, context: HostEffectContext): Promise<ToolRemoteResult> {
		const { operation, revision, signal, limits, validate, verify, run } = context;
		const timeoutMs = limits.toolTimeoutSeconds * 1000;

		if (input.kind === 'deliver') {
			const remote = this.model.remote(operation);
			if (
				!input.paths.length ||
				new Set(input.paths).size !== input.paths.length ||
				input.paths.some(
					(path) =>
						path === '/' ||
						!posix.isAbsolute(path) ||
						posix.normalize(path) !== path ||
						/[\u0000-\u001f\u007f]/u.test(path),
				)
			) {
				throw new AgentFailure('invalid_input');
			}
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
			const items: ToolDeliveryItem[] = [];
			for (let index = 0; index < input.paths.length; index++) {
				try {
					await validate();
					const saved = await remote.consumeFile(
						input.paths[index],
						await this.artifacts.availableBytes(actor, 0),
						operationScope,
						(file, source) =>
							this.artifacts.importTool(
								actor,
								file.name,
								file.sizeBytes,
								source,
								signal,
								context.recordOutputArtifacts,
							),
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
						if (error instanceof ToolExecutionUnknown) {
							const Failure =
								error instanceof ToolCleanupFailure
									? ToolBatchCleanupFailure
									: ToolBatchExecutionUnknown;
							throw new Failure(
								JSON.stringify({ items }),
								error,
								items.flatMap((item) => (item.status === 'completed' ? [item.value.id] : [])),
							);
						}
						throw error;
					}
					break;
				}
			}
			await validate();
			return {
				operation: 'remote.deliver',
				value: { items },
				targets: [{ id: target.id, version: target.version }],
				outputArtifactIds: items.flatMap((item) => (item.status === 'completed' ? [item.value.id] : [])),
			};
		}

		if (input.kind === 'project') {
			const value = await this.projects.perform(input.input, operation, target, revision, signal, validate);
			return {
				operation: input.input.action === 'read' ? 'project.bindingRead' : 'project.bindingWrite',
				value,
				targets: [{ id: target.id, version: target.version }],
			};
		}

		if (input.kind === 'job') {
			const value = await this.jobs.control(
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
			return { operation: 'shell.jobs', value, targets: [{ id: target.id, version: target.version }] };
		}
		if (input.kind === 'shell') {
			const remote = this.model.remote(operation);

			const jobValidate = async (jobSignal: AbortSignal) => {
				await this.model.validateTarget(target);
				await verify(jobSignal);
			};

			const value = await this.jobs.prepare({
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
					operation: 'shell.execute',
					value: await this.jobs.foreground(
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
			return { operation: 'shell.execute', value, targets: [{ id: target.id, version: target.version }] };
		}
		const value = await this.model.remote(operation).perform(input, {
			operationId: operation.id,
			target,
			signal,
			validate,
			timeoutMs,
		});
		await validate();
		return { ...value, targets: [{ id: target.id, version: target.version }] };
	}
}
