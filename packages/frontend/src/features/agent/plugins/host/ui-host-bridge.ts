import { logger } from '@/client/logging/logger';
import { readAgentMemoryInvalidation } from '@nexus-terminal/shared/agent/memory/events';
import { agentInteger, agentRecord, readAgentId, encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import { AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { AGENT_RUN_STREAM_MAX_JSON_BYTES } from '@nexus-terminal/shared/agent/runs/values';
import { readAgentPluginUiHostInput } from '@nexus-terminal/shared/agent/plugins/ui-events-codec';
import type {
	AgentPluginFrontendInput,
	AgentPluginFrontendResult,
} from '@nexus-terminal/shared/agent/plugins/frontend-events';
import type {
	AgentPluginUiEnvironment,
	AgentPluginUiHostInput,
	AgentPluginUiHostResult,
	AgentPluginUiTask,
	AgentPluginUiHostMessage,
} from '@nexus-terminal/shared/agent/plugins/ui-events';
import { readAgentRunStreamCommand, readAgentRunStreamEvent } from '@nexus-terminal/shared/agent/runs/events';
import type { AgentStreamSource, AgentRunStreamUpdate } from '@nexus-terminal/shared/agent/runs/events';
import type { AgentMemoryInvalidation } from '@nexus-terminal/shared/agent/memory/events';
import { readAgentApprovalView } from '@nexus-terminal/shared/agent/governance/http-codec';
import { readAgentArtifactResponse } from '@nexus-terminal/shared/agent/artifacts/http-codec';
import {
	AGENT_ARTIFACT_MAX_BYTES,
	AGENT_ARTIFACT_MAX_RESPONSE_BYTES,
	AGENT_ARTIFACT_MAX_BODY_BYTES,
} from '@nexus-terminal/shared/agent/artifacts/values';
import { AGENT_MAX_JSON_BODY_BYTES, AGENT_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/values';
import type { PluginFrontendDescriptor } from './plugin-runtime-types';
import type { PluginFrontendUiBridge } from './ui-bridge-types';
import { requestPluginFrontendRpc } from './plugin-runtime-api';
import { rejectAgentManagementResponse } from '../../api/management-errors';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { requestAgentManagement } from '../../api/management-request';
import { requestBinary } from '@/client/http/binary-client';
import { useFeedback } from '@/shared/feedback/public';
import { AgentManagementFailure } from '../../model/management-failure';
import { fromNativeApproval } from '../../model/native-run-mapper';
import {
	formatToolSummary,
	formatToolTargets,
	toolCommandPreview,
	toolDisplayName,
} from '../../runtime/native-tool-summary';
import type { AgentHostState } from '../../host/agent-host-state';
import { subscribeAgentPageStream } from '../../api/page-stream';
import { readAgentPluginUiEnvironment } from '@nexus-terminal/shared/agent/plugins/ui-events-codec';
import { readAgentPluginUiStreamCommand } from '@nexus-terminal/shared/agent/plugins/ui-streams-codec';
import { uiCheckpointKey } from '../../host/agent-host-state';
import type { useAgentResourceControl } from '../../composables/use-agent-resource-control';
import type { NativeApproval } from '../../model/native-run-types';
import type { ManagedArtifact } from '../../model/artifact-types';
import type { HostArtifactPickerRequest } from './host-artifact-selection-types';
import { createHostArtifactSelection } from './host-artifact-selection';

interface StreamOwner {
	stream: { resume(): void; close(): void; resubscribe(): void } | null;
	pending: { generation: number; revision: number; delivery: number } | null;
	acknowledge(generation: number, revision: number, delivery: number): void;
}

interface HostUiOptions {
	environment(): AgentPluginUiEnvironment;
	rememberTargets(ids: number[]): void;
	host: AgentHostState;
	feedback: ReturnType<typeof useFeedback>;
	resources: ReturnType<typeof useAgentResourceControl>;
	frame(): HTMLIFrameElement | null;
	pickArtifacts(request: HostArtifactPickerRequest, signal: AbortSignal): Promise<ManagedArtifact[]>;
	t(key: string, named?: Record<string, string>): string;
	te(key: string): boolean;
}

/** Each instance is bound to one authenticated frame and its exact signed UI installation. */
export class PluginUiHostBridge implements PluginFrontendUiBridge {
	private port: MessagePort | null = null;
	private readonly signal = new AbortController();
	private readonly pending = new Map<string, AbortController>();
	private readonly streams = new Map<string, StreamOwner>();
	private readonly activity;
	private readonly artifactSelection;
	private sequence = 0;
	private taskGeneration = 0;
	private closed = false;
	private closePromise: Promise<void> | null = null;
	private readonly tasks = new Set<Promise<void>>();
	private readonly failures: unknown[] = [];
	private failureHandler: ((error: unknown) => void) | null = null;

	constructor(
		private readonly descriptor: PluginFrontendDescriptor,
		private readonly options: HostUiOptions,
	) {
		this.activity = options.host.registerTaskActivity();
		this.artifactSelection = createHostArtifactSelection({
			appId: descriptor.appId,
			frame: options.frame,
			pick: options.pickArtifacts,
		});
	}

	setFailureHandler(listener: (error: unknown) => void): void {
		this.failureHandler = listener;
	}

	private recordFailure(error: unknown): void {
		if (this.failures.includes(error)) return;
		this.failures.push(error);
		logger.error({ appId: this.descriptor.appId, err: error }, 'Plugin UI bridge failed');
	}

	private fail(error: unknown): void {
		this.recordFailure(error);
		try {
			this.failureHandler?.(error);
		} catch (cause) {
			this.recordFailure(cause);
		}
		void this.close();
	}

	private track(task: Promise<void>): void {
		this.tasks.add(task);
		void task.then(
			() => {
				this.tasks.delete(task);
			},
			(error: unknown) => {
				this.tasks.delete(task);
				this.fail(error);
			},
		);
	}

	connect(port: MessagePort): void {
		if (!this.closed) {
			this.port = port;
			this.updateEnvironment();
		}
	}

	private post(message: AgentPluginUiHostMessage): void {
		try {
			const streamPage =
				message !== null &&
				typeof message === 'object' &&
				'type' in message &&
				message.type === 'nexus.ui.stream.page';
			encodeAgentJson(
				message,
				streamPage ? AGENT_RUN_STREAM_MAX_JSON_BYTES + 1024 : AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
			);
			this.port?.postMessage(message);
		} catch (error) {
			this.fail(error);
			throw error;
		}
	}

	updateEnvironment(): void {
		if (!this.closed)
			this.post({
				type: 'nexus.ui.environment',
				environment: readAgentPluginUiEnvironment(this.options.environment()),
			});
	}

	handle(input: unknown, port: MessagePort): boolean {
		if (
			input === null ||
			typeof input !== 'object' ||
			!('type' in input) ||
			typeof input.type !== 'string' ||
			!input.type.startsWith('nexus.ui.')
		)
			return false;
		if (this.closed || port !== this.port) return true;
		try {
			if (input.type === 'nexus.ui.request') {
				const r = agentRecord(
					input,
					Object.hasOwn(input, 'file') ? ['type', 'id', 'input', 'file'] : ['type', 'id', 'input'],
					AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
				);
				const id = readAgentId(r.id);
				const request = readAgentPluginUiHostInput(r.input);
				if (
					this.pending.has(id) ||
					(r.file !== undefined && (request.kind !== 'artifact.upload' || !(r.file instanceof File)))
				)
					throw new Error('Invalid UI request');
				const controller = new AbortController();
				this.pending.set(id, controller);
				const signal = AbortSignal.any([controller.signal, this.signal.signal]);
				const task = this.execute(request, signal, r.file instanceof File ? r.file : undefined)
					.then(
						(result) => {
							if (!this.closed && !signal.aborted) this.post({ type: 'nexus.ui.response', id, result });
						},
						(error: unknown) => {
							if (!(error instanceof AgentManagementFailure) && !(error instanceof HttpRequestFailure))
								this.recordFailure(error);
							if (!this.closed && !signal.aborted)
								this.post({
									type: 'nexus.ui.failure',
									id,
									error:
										error instanceof AgentManagementFailure || error instanceof HttpRequestFailure
											? { code: error.code, outcome: error.outcome }
											: {
													code:
														request.kind === 'artifact.selection.read' ||
														request.kind === 'feedback.confirm'
															? 'request_failed'
															: 'operation_unknown',
													outcome:
														request.kind === 'artifact.selection.read' ||
														request.kind === 'feedback.confirm'
															? 'confirmed'
															: 'unknown',
												},
								});
						},
					)
					.finally(() => {
						if (this.pending.get(id) === controller) this.pending.delete(id);
					});
				this.track(task);
			} else if (input.type === 'nexus.ui.cancel') {
				const r = agentRecord(input, ['type', 'id']);
				this.pending.get(readAgentId(r.id))?.abort();
			} else if (input.type === 'nexus.ui.stream.subscribe')
				this.subscribe(readAgentPluginUiStreamCommand(input));
			else if (input.type === 'nexus.ui.stream.ack') {
				const r = readAgentPluginUiStreamCommand(input);
				if (r.type !== 'nexus.ui.stream.ack') throw new Error('Invalid UI ACK');
				const owner = this.streams.get(readAgentId(r.id));
				const generation = agentInteger(r.generation, 1);
				const revision = agentInteger(r.revision, 1);
				const delivery = agentInteger(r.delivery, 1);
				// An already retired subscription has no credit left for a late ACK to release.
				owner?.acknowledge(generation, revision, delivery);
			} else if (input.type === 'nexus.ui.stream.unsubscribe') {
				const r = readAgentPluginUiStreamCommand(input);
				if (r.type !== 'nexus.ui.stream.unsubscribe') throw new Error('Invalid UI unsubscribe');
				const id = r.id;
				this.streams.get(id)?.stream?.close();
				this.streams.delete(id);
			} else throw new Error('Unknown UI operation');
		} catch (error) {
			this.fail(error);
		}
		return true;
	}

	private rpc(request: AgentPluginFrontendInput, signal = this.signal.signal): Promise<AgentPluginFrontendResult> {
		const task = this.performRpc(request, signal);
		this.track(
			task.then(
				() => undefined,
				(error: unknown) => {
					if (!(error instanceof AgentManagementFailure) && !(error instanceof HttpRequestFailure))
						this.recordFailure(error);
				},
			),
		);
		return task;
	}

	private async performRpc(
		request: AgentPluginFrontendInput,
		signal = this.signal.signal,
	): Promise<AgentPluginFrontendResult> {
		if (this.closed || signal.aborted) throw new AgentManagementFailure('cancelled', 'not_dispatched');
		const result = await requestPluginFrontendRpc(
			this.descriptor,
			{
				type: 'nexus.plugin.request',
				protocol: 4,
				nonce: crypto.randomUUID(),
				id: crypto.randomUUID(),
				seq: ++this.sequence,
				request,
			},
			signal,
		);
		if (this.closed || signal.aborted) throw new AgentManagementFailure('cancelled', 'unknown');
		if (!result.ok)
			throw new AgentManagementFailure(
				result.error.code,
				result.error.code === 'operation_unknown' ? 'unknown' : 'confirmed',
			);
		return result.result;
	}

	async authorize(request: AgentPluginFrontendInput, requestSignal?: AbortSignal): Promise<boolean> {
		const signal = requestSignal ? AbortSignal.any([requestSignal, this.signal.signal]) : this.signal.signal;
		if (this.closed) return false;
		if (
			(request.method === 'agent.runs.create' || request.method === 'agent.runs.appendInput') &&
			request.params.input.approvalMode === 'full_access'
		) {
			const accepted = await this.options.feedback.confirm({
				title: this.options.t('agent.operations.approvalFullAccess'),
				message: this.options.t('agent.operations.approvalFullAccessDesc'),
				confirmText: this.options.t('agent.approvals.allowOnce'),
				cancelText: this.options.t('common.cancel'),
				destructive: true,
				signal,
			});
			return !this.closed && !signal.aborted && accepted;
		}
		if (request.method !== 'agent.approvals.resolve') return true;
		const approval = await requestAgentManagement({
			method: 'GET',
			apiBase: '/api/v1/apps',
			path: '/' + this.descriptor.appId + '/approvals/' + request.params.approvalId,
			maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
			maxResponseBytes: AGENT_MAX_RESPONSE_BYTES,
			signal,
			decode: readAgentApprovalView,
		});
		if (
			this.closed ||
			approval.id !== request.params.approvalId ||
			approval.appId !== this.descriptor.appId ||
			approval.status !== 'requested' ||
			approval.version !== request.params.input.expectedVersion ||
			approval.operationHash !== request.params.input.operationHash
		)
			return false;
		const preview = toolCommandPreview(approval.summary);
		const summary = formatToolSummary(
			approval.summary,
			{ kind: 'host', operation: approval.operationName },
			{
				translate: (key, named) => this.options.t(key, named),

				has: (key) => this.options.te(key),
			},
		);
		const message = [
			summary,
			preview?.text,
			preview?.truncated ? this.options.t('agent.approvals.commandTruncated') : undefined,
		]
			.filter((value): value is string => Boolean(value))
			.join('\n\n');
		const targets = new Map(
			this.options
				.environment()
				.targets.map((target) => [target.id, `${target.name || target.host} (#${target.id})`]),
		);
		const name = toolDisplayName({ kind: 'host', operation: approval.operationName });
		const details = [
			{
				label: this.options.t('agent.tasks.title'),
				value: name,
				mono: true,
			},
			{
				label: this.options.t('agent.operations.targets'),
				value: formatToolTargets(approval.summary, approval.targetId, targets),
			},
		];
		details.push({
			label: this.options.t('agent.approvals.hash'),
			value: approval.operationHash,
			mono: true,
		});
		const accepted = await this.options.feedback.confirm({
			title: this.options.t('agent.approvals.title'),
			message,
			confirmText: this.options.t(
				request.params.input.decision === 'denied' ? 'agent.approvals.rejectOnce' : 'agent.approvals.approve',
			),
			cancelText: this.options.t('common.cancel'),
			destructive: approval.risk !== 'read',
			signal,
			details,
		});
		return !this.closed && !signal.aborted && accepted;
	}

	private async execute(
		input: AgentPluginUiHostInput,
		signal: AbortSignal,
		file?: File,
	): Promise<AgentPluginUiHostResult> {
		if (input.kind === 'checkpoint.save') {
			if (this.closed || signal.aborted || this.descriptor.expiresAt <= Date.now())
				throw new AgentManagementFailure('cancelled', 'not_dispatched');
			const environment = readAgentPluginUiEnvironment(this.options.environment());
			environment.checkpoint = { version: input.checkpoint.version, valueJson: input.checkpoint.valueJson };
			encodeAgentJson({ type: 'nexus.ui.environment', environment }, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
			this.options.host.uiCheckpoints.set(
				uiCheckpointKey(
					this.descriptor.appId,
					this.descriptor.package.packageId,
					this.descriptor.package.publisherKeyId,
				),
				{ version: input.checkpoint.version, valueJson: input.checkpoint.valueJson },
			);
			return { kind: input.kind, accepted: true };
		}
		// Browser interactions are still checked against the original grant before any Host action.
		await this.rpc({ method: 'host.appInfo', params: {} }, signal);
		const environment = this.options.environment();
		if (input.kind === 'targets.remember') {
			const allowed = new Set(environment.targets.map((target) => target.id));
			this.options.rememberTargets(input.ids.filter((id) => allowed.has(id)));
			this.updateEnvironment();
			return { kind: input.kind, accepted: true };
		}
		if (input.kind === 'window.open') {
			this.options.host.windowManager.openHub({ appId: this.descriptor.appId });
			this.options.host.windowManager.switchApp({ appId: this.descriptor.appId });
			return { kind: input.kind, accepted: true };
		}
		if (input.kind === 'feedback.notify') {
			const duration = input.duration ?? undefined;
			if (input.tone === 'error') this.options.feedback.notifyError(input.message, duration);
			else if (input.tone === 'success') this.options.feedback.notifySuccess(input.message, duration);
			else if (input.tone === 'warning') this.options.feedback.notifyWarning(input.message, duration);
			else this.options.feedback.notifyInfo(input.message, duration);
			return { kind: input.kind, accepted: true };
		}
		if (input.kind === 'feedback.confirm') {
			const confirmed = await this.options.feedback.confirm({
				title: input.title,
				message: input.message,
				confirmText: input.confirmText || undefined,
				cancelText: input.cancelText || undefined,
				destructive: input.destructive,
				signal,
			});
			return { kind: input.kind, confirmed: confirmed && !signal.aborted && !this.closed };
		}
		if (input.kind === 'resources.close') {
			const confirmed = await this.options.resources.close(
				{ appId: this.descriptor.appId, appVersion: environment.appVersion },
				input.target,
				signal,
			);
			return { kind: input.kind, closed: confirmed };
		}
		if (input.kind === 'task.update') {
			await this.updateTask(input.task, signal);
			return { kind: input.kind, accepted: true };
		}
		if (input.kind === 'artifact.selection.open') {
			if (!environment.active || environment.minimized)
				throw new AgentManagementFailure('cancelled', 'not_dispatched');
			const selections = await this.artifactSelection.open(input.anchor, input.keys, signal);
			return { kind: input.kind, selections };
		}
		if (input.kind === 'artifact.selection.read') {
			const selections = await this.artifactSelection.read(input.keys, signal);
			return { kind: input.kind, selections };
		}
		if (input.kind === 'artifact.selection.attach') {
			const selection = await this.artifactSelection.attach(input.key, input.threadId, signal);
			return { kind: input.kind, selection };
		}
		if (input.kind === 'artifact.upload') {
			if (!file || file.size > AGENT_ARTIFACT_MAX_BYTES)
				throw new AgentManagementFailure('invalid_input', 'not_dispatched');
			const response = await requestBinary({
				method: 'PUT',
				url:
					'/api/v1/agent/plugins/installations/' +
					this.descriptor.appId +
					'/frontend/artifacts/' +
					input.artifactId +
					'/content?grant=' +
					encodeURIComponent(this.descriptor.grant),
				headers: { 'If-Match': '"' + input.expectedVersion + '"', 'Content-Type': 'application/octet-stream' },
				body: file,
				maxRequestBytes: AGENT_ARTIFACT_MAX_BYTES,
				maxResponseBytes: AGENT_ARTIFACT_MAX_RESPONSE_BYTES,
				maxErrorBytes: AGENT_ARTIFACT_MAX_BODY_BYTES,
				timeoutMs: 75_000,
				signal,
			});
			if (response.status >= 400)
				rejectAgentManagementResponse(
					response.status,
					JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)),
				);
			if (response.status !== 200) throw new AgentManagementFailure('protocol_failure', 'unknown');
			const result = readAgentArtifactResponse(
				JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)),
			);
			if (
				result.artifact.id !== input.artifactId ||
				result.artifact.appId !== this.descriptor.appId ||
				signal.aborted
			)
				throw new AgentManagementFailure('protocol_failure', 'unknown');
			return { kind: input.kind, result };
		}
		if (input.kind === 'artifact.download') {
			const result = await this.rpc(
				{ method: 'agent.artifacts.get', params: { artifactId: input.artifactId } },
				signal,
			);
			if (result.method !== 'agent.artifacts.get')
				throw new AgentManagementFailure('protocol_failure', 'unknown');
			const link = document.createElement('a');
			link.href = '/api/v1/agent/apps/' + this.descriptor.appId + '/artifacts/' + input.artifactId + '/content';
			link.download = result.value.artifact.name;
			link.rel = 'noopener';
			document.body.append(link);
			link.click();
			link.remove();
			return { kind: input.kind, accepted: true };
		}
		throw new AgentManagementFailure('invalid_input', 'not_dispatched');
	}

	private async updateTask(task: AgentPluginUiTask | null, signal: AbortSignal): Promise<void> {
		const generation = ++this.taskGeneration;
		if (!task) {
			this.activity.update(null);
			return;
		}
		const [run, approvals, usage] = await Promise.all([
			this.rpc({ method: 'agent.runs.get', params: { runId: task.runId } }, signal),
			this.rpc({ method: 'agent.approvals.list', params: { runId: task.runId, after: null } }, signal),
			this.rpc({ method: 'agent.runs.usage', params: { runId: task.runId } }, signal),
		]);
		if (
			generation !== this.taskGeneration ||
			signal.aborted ||
			this.closed ||
			run.method !== 'agent.runs.get' ||
			!run.value ||
			approvals.method !== 'agent.approvals.list' ||
			usage.method !== 'agent.runs.usage'
		)
			return;
		const environment = this.options.environment();
		this.activity.update({
			appId: this.descriptor.appId,
			appVersion: environment.appVersion,
			threadTitle: task.threadTitle,
			runId: run.value.id,
			locallyStarted: task.locallyStarted,
			status: run.value.status,
			preview: task.preview,
			approvals: approvals.value.items
				.filter((approval) => approval.status === 'requested')
				.map(fromNativeApproval),
			targetLabels: new Map(environment.targets.map((target) => [target.id, target.name || target.host])),
			toolExecutions: usage.value.toolExecutions,
			blocked: task.blocked,
			failureKey: task.failureKey,
			failureMessage: task.failureMessage,

			open: () => {
				if (this.closed) return;
				this.options.host.windowManager.openHub({ appId: this.descriptor.appId });
				this.options.host.windowManager.switchApp({ appId: this.descriptor.appId });
				this.post({ type: 'nexus.ui.task.open', runId: task.runId });
			},

			decide: (approval, decision) => {
				if (!this.closed) this.track(this.decide(approval, decision));
			},
		});
	}

	private async decide(
		approval: NativeApproval,
		decision: import('@nexus-terminal/shared/agent/governance/values').AgentApprovalDecision,
	): Promise<void> {
		const request: AgentPluginFrontendInput = {
			method: 'agent.approvals.resolve',
			params: {
				approvalId: approval.id,
				operationId: crypto.randomUUID(),
				input: { decision, operationHash: approval.operationHash, expectedVersion: approval.version },
			},
		};
		try {
			if (await this.authorize(request)) await this.rpc(request);
		} catch (error) {
			if (!(error instanceof AgentManagementFailure) && !(error instanceof HttpRequestFailure))
				this.recordFailure(error);
			if (!this.closed) this.options.feedback.notifyError(this.options.t('agent.settings.appManagement.unknown'));
		}
	}

	private subscribe(input: unknown): void {
		const r = agentRecord(input, ['type', 'id', 'source']);
		const id = readAgentId(r.id);
		if (this.streams.has(id)) throw new Error('Duplicate UI subscription');
		const raw = agentRecord(
			r.source,
			Object.keys(r.source !== null && typeof r.source === 'object' ? r.source : {}),
		);
		let source: AgentStreamSource;
		if (raw.kind === 'run') {
			const p = agentRecord(raw, ['kind', 'runId', 'cursor']);
			const command = readAgentRunStreamCommand({
				type: 'subscribe',
				subscriptionId: id,
				generation: 1,
				source: {
					kind: 'run',
					appId: this.descriptor.appId,
					access: { kind: 'plugin', grant: this.descriptor.grant },
					runId: p.runId,
					cursor: p.cursor,
				},
			});
			if (command.type !== 'subscribe') throw new Error('Invalid subscription');
			source = command.source;
		} else {
			const p = agentRecord(raw, ['kind', 'threadId']);
			if (p.kind !== 'memory') throw new Error('Invalid subscription');
			source = {
				kind: 'memory',
				appId: this.descriptor.appId,
				access: { kind: 'plugin', grant: this.descriptor.grant },
				threadId: p.threadId === null ? null : readAgentId(p.threadId),
			};
		}
		let generation = 0;
		let delivery = 0;
		let resetRequired = false;
		let advance: (() => void) | null = null;
		const owner: StreamOwner = {
			stream: null,
			pending: null,

			acknowledge: (expectedGeneration, revision, expectedDelivery) => {
				const pending = owner.pending;
				if (
					!pending ||
					pending.generation !== expectedGeneration ||
					pending.revision !== revision ||
					pending.delivery !== expectedDelivery
				)
					throw new Error('Invalid UI stream acknowledgement');
				advance?.();
				advance = null;
				owner.pending = null;
				if (resetRequired) {
					resetRequired = false;
					owner.stream?.resubscribe();
				} else owner.stream?.resume();
			},
		};
		this.streams.set(id, owner);
		owner.stream = subscribeAgentPageStream({
			source: () => {
				if (generation >= Number.MAX_SAFE_INTEGER) throw new Error('UI stream generation exhausted');
				generation += 1;
				if (owner.pending) resetRequired = true;
				return source;
			},

			apply: (value, revision) => {
				if (this.closed || this.streams.get(id) !== owner) return false;
				if (owner.pending) return false;
				let projected: AgentRunStreamUpdate | AgentMemoryInvalidation;
				if (source.kind === 'run') {
					const current = source;
					const event = readAgentRunStreamEvent(
						value,
						{
							appId: this.descriptor.appId,
							appVersion: this.options.environment().appVersion,
							runId: current.runId,
						},
						current.cursor,
					);
					if (event.type !== 'update' || event.revision !== revision)
						throw new Error('Invalid run stream page');
					projected = event;
					advance = () => {
						source = {
							kind: 'run',
							appId: current.appId,
							access: current.access,
							runId: current.runId,
							cursor: {
								threadId: current.cursor.threadId,
								entries: {
									runSequence: event.body.nextCursor.runSequence,
									messageOrdinal: event.body.nextCursor.messageOrdinal,
									chunkIndex: event.body.nextCursor.chunkIndex,
									textOffset: event.body.nextCursor.textOffset,
								},
								events: event.state?.events.nextCursor ?? current.cursor.events,
								approvals: event.state
									? event.state.approvals.hasMore
										? event.state.approvals.nextCursor
										: null
									: current.cursor.approvals,
							},
						};
					};
				} else {
					if (source.kind !== 'memory') throw new Error('Invalid UI stream source');
					projected = readAgentMemoryInvalidation(value);
				}
				if (delivery >= Number.MAX_SAFE_INTEGER) throw new Error('UI stream delivery exhausted');
				owner.pending = { generation, revision, delivery: ++delivery };
				this.post({ type: 'nexus.ui.stream.page', id, generation, revision, delivery, value: projected });
				return true;
			},

			rejected: (code) => {
				if (this.streams.get(id) !== owner) return;
				this.streams.delete(id);
				owner.pending = null;
				advance = null;
				owner.stream?.close();
				if (!this.closed) this.post({ type: 'nexus.ui.stream.failure', id, code });
			},
		});
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		const tasks = [...this.tasks];
		this.closePromise = Promise.resolve().then(async () => {
			await Promise.allSettled(tasks);
			if (this.failures.length)
				throw new AggregateError(this.failures.slice(), 'Plugin UI capabilities failed to close');
		});
		void this.closePromise.catch((error: unknown) => {
			logger.error({ appId: this.descriptor.appId, err: error }, 'Plugin UI close failed');
		});
		this.closed = true;
		this.taskGeneration += 1;

		const cleanup = (work: () => void) => {
			try {
				work();
			} catch (error) {
				this.recordFailure(error);
			}
		};

		cleanup(() => this.signal.abort());
		cleanup(() => this.post({ type: 'nexus.ui.closed' }));
		this.port = null;
		for (const request of this.pending.values()) cleanup(() => request.abort());
		this.pending.clear();
		for (const owner of this.streams.values()) cleanup(() => owner.stream?.close());
		this.streams.clear();
		cleanup(() => this.artifactSelection.close());
		cleanup(() => this.activity.dispose());
		return this.closePromise;
	}
}
