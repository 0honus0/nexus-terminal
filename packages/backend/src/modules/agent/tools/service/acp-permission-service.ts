import { toolAuthorityIdentity } from '../../governance/governance-rules.js';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AGENT_APPROVAL_MAX_SUMMARY_BYTES } from '@nexus-terminal/shared/agent/governance/values';
import type { RunToolModel } from '../../runs/model/run-tool-model.js';
import type { ToolOperation } from '../../runs/model/run-tool-types.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { ToolTarget, ToolAcpPermission, ToolAcpPermissionResponse } from '../model/tool-types.js';
import { AgentFailure, ToolExecutionUnknown, ToolCleanupFailure, isAgentDrainFailure } from '../../agent-failure.js';

function hash(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Each inner permission has a durable identity; no parent approval or stale waiter can grant it. */
export class AcpPermissionService {
	constructor(
		private readonly journal: RunToolModel,
		private readonly governance: GovernanceService,
	) {}

	async execute(
		parent: ToolOperation,
		target: ToolTarget,
		revision: number,
		signal: AbortSignal,
		timeoutMs: number,
		validate: (signal: AbortSignal) => Promise<void>,
		work: (
			signal: AbortSignal,
			permission: (input: ToolAcpPermission, signal: AbortSignal) => Promise<ToolAcpPermissionResponse>,
			timeoutMs: number,
		) => Promise<string>,
	): Promise<string> {
		const controller = new AbortController();
		const monitor = new AbortController();
		let authorityFailure: unknown = null;

		const abort = () => controller.abort();

		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) {
			abort();
		}
		const deadline = Date.now() + timeoutMs;
		const timer = setTimeout(abort, timeoutMs);
		const monitoring = Promise.resolve().then(async () => {
			while (!monitor.signal.aborted) {
				try {
					await delay(1000, undefined, { signal: monitor.signal });
				} catch (error) {
					if (monitor.signal.aborted) {
						return;
					}
					throw error;
				}
				if (monitor.signal.aborted) {
					return;
				}
				try {
					await validate(controller.signal);
				} catch (error) {
					authorityFailure = error;
					abort();
					return;
				}
			}
		});
		void monitoring.catch((error: unknown) => {
			authorityFailure = error;
			abort();
		});
		try {
			await validate(controller.signal);
			const result = await work(
				controller.signal,
				(input, permissionSignal) =>
					this.request(parent, target, revision, input, permissionSignal, controller.signal, validate),
				Math.max(1, deadline - Date.now()),
			);
			await validate(controller.signal);
			monitor.abort();
			await monitoring.catch(() => undefined);
			if (authorityFailure !== null) {
				throw authorityFailure;
			}
			return result;
		} catch (error) {
			monitor.abort();
			await monitoring.catch(() => undefined);
			if (authorityFailure !== null && authorityFailure !== error) {
				const cause = new AggregateError([error, authorityFailure], 'ACP execution and authority failed');
				if (
					(isAgentDrainFailure(error) && !(error instanceof ToolExecutionUnknown)) ||
					(isAgentDrainFailure(authorityFailure) && !(authorityFailure instanceof ToolExecutionUnknown))
				) {
					throw cause;
				}
				if (error instanceof ToolCleanupFailure) {
					throw new ToolCleanupFailure({ cause });
				}
				throw new ToolExecutionUnknown({ cause });
			}
			throw error;
		} finally {
			clearTimeout(timer);
			monitor.abort();
			controller.abort();
			signal.removeEventListener('abort', abort);
			await monitoring.catch(() => undefined);
		}
	}

	private async request(
		parent: ToolOperation,
		target: ToolTarget,
		revision: number,
		input: ToolAcpPermission,
		signal: AbortSignal,
		executionSignal: AbortSignal,
		validate: (signal: AbortSignal) => Promise<void>,
	): Promise<ToolAcpPermissionResponse> {
		await validate(signal);
		const argumentsJson = JSON.stringify({
			parentId: parent.id,
			parentHash: parent.operationHash,
			sessionId: input.sessionId,
			toolCallId: input.toolCallId,
			requestId: input.requestId,
			title: input.title,
			kind: input.kind,
			inputBytes: Buffer.byteLength(input.inputJson, 'utf8'),
			inputSha256: hash(input.inputJson),
			targetFingerprint: target.fingerprint,
		});
		const summary = JSON.stringify({
			parentToolCallId: parent.id,
			title: input.title,
			kind: input.kind,
			sessionSha256: hash(input.sessionId),
			toolCallSha256: hash(input.toolCallId),
			inputBytes: Buffer.byteLength(input.inputJson, 'utf8'),
			inputSha256: hash(input.inputJson),
		});
		if (Buffer.byteLength(summary, 'utf8') > AGENT_APPROVAL_MAX_SUMMARY_BYTES) {
			throw new AgentFailure('limit_exceeded');
		}
		let current = await this.journal.inspectPermission(
			{
				parent: { userId: parent.userId, appId: parent.appId, runId: parent.runId, id: parent.id },
				maxPermissions: 64,
				inspection: {
					id: randomUUID(),
					userId: parent.userId,
					appId: parent.appId,
					runId: parent.runId,
					modelStepIndex: parent.modelStepIndex,
					providerCallId: 'acp:' + hash(JSON.stringify([parent.id, input.sessionId, input.requestId])),
					toolName: 'acp_inner_permission',
					toolVersion: '2.0.0',
					capability: 'integration.acp.invoke',
					targetId: target.id,
					targetVersion: target.version,
					risk: 'destructive',
					mutation: true,
					summary,
					argumentsJson,
					expectedOperationRevision: null,
				},
			},
			(candidate, status) =>
				status === 'running' &&
				candidate.state === 'dispatched' &&
				(candidate.toolName === 'acp_execute' || candidate.toolName === 'acp_integration_execute') &&
				candidate.operationHash === parent.operationHash &&
				candidate.capability === 'integration.acp.invoke' &&
				candidate.mutation,
		);
		try {
			const approval = await this.governance.request({
				userId: parent.userId,
				appId: parent.appId,
				runId: parent.runId,
				id: randomUUID(),
				toolCallId: current.id,
				kind: 'acp_permission',
			});
			if (!approval || approval.policyRevision !== revision) {
				throw new AgentFailure('approval_stale');
			}
			let allowed = false;
			while (true) {
				await validate(signal);
				const valid = await this.governance.toolAuthority(toolAuthorityIdentity(current), {
					kind: 'inspect',
					policyRevision: revision,
				});
				const latest = await this.governance.approval(parent.userId, parent.appId, approval.id);
				if (!valid || !latest || Date.now() >= latest.expiresAt * 1000) {
					throw new AgentFailure('approval_stale');
				}
				if (latest.status === 'approved') {
					current = await this.governance.consume({
						userId: parent.userId,
						appId: parent.appId,
						approvalId: latest.id,
						expectedVersion: latest.version,
					});
					allowed = true;
					break;
				}
				if (latest.status === 'denied') {
					break;
				}
				if (latest.status !== 'requested') {
					throw new AgentFailure('approval_stale');
				}
				try {
					await delay(1000, undefined, { signal });
				} catch (cause) {
					if (signal.aborted) {
						throw new AgentFailure('approval_stale', { cause });
					}
					throw cause;
				}
			}
			let delivered = false;
			return {
				decision: allowed ? 'allow_once' : 'reject_once',

				delivered: async () => {
					if (delivered) {
						throw new AgentFailure('version_conflict');
					}
					delivered = true;
					await validate(executionSignal);
					if (allowed) {
						const completed = await this.governance.toolAuthority(toolAuthorityIdentity(current), {
							kind: 'complete',
							policyRevision: revision,
							resultText: JSON.stringify({ decision: 'allow_once', delivery: 'sent' }),
							targets: [{ id: target.id, version: target.version }],
						});
						if (!completed) {
							throw new ToolExecutionUnknown();
						}
						current = completed.operation;
					} else {
						current = await this.journal.finish({
							identity: {
								userId: parent.userId,
								appId: parent.appId,
								runId: parent.runId,
								id: current.id,
							},
							expectedRevision: current.revision,
							state: 'cancelled',
							resultText: null,
						});
					}
				},
			};
		} catch (error) {
			if (isAgentDrainFailure(error) && !(error instanceof ToolExecutionUnknown)) {
				throw error;
			}
			try {
				await this.journal.finish({
					identity: { userId: parent.userId, appId: parent.appId, runId: parent.runId, id: current.id },
					expectedRevision: current.revision,
					state: current.state === 'inspected' ? 'cancelled' : 'unknown',
					resultText: null,
				});
			} catch (settlement) {
				if (settlement instanceof AgentFailure && settlement.code === 'version_conflict') {
					throw error;
				}
				throw new AggregateError([error, settlement], 'ACP permission and settlement failed');
			}
			throw error;
		}
	}
}
