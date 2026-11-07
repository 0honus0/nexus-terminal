import { createHash } from 'node:crypto';
import { readAgentPluginModelResponse } from '@nexus-terminal/shared/agent/plugins/app-runtime';
import { AgentFailure, ProviderRequestFailure } from '../../agent-failure.js';
import { OperationEffectFailure, operationReceiptFailure } from '../../operations/model/operation-failure.js';
import type { OperationContentService } from '../../operations/service/operation-content-service.js';
import type { ModelInvocationModel } from '../model/model-invocation-model.js';
import type {
	ModelInvocationContext,
	ModelInvocationInput,
	ModelInvocationResult,
} from '../model/model-invocation-types.js';
import type { ModelInvocationSelection, ModelInvocationDescriptor } from '../model/model-invocation-types.js';
import type { ModelInvocationMessage, ModelInvocationPreparedMessage } from '../model/model-invocation-types.js';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { ArtifactActor, ArtifactContent } from '../../artifacts/model/artifact-types.js';
import type { OperationReceipt } from '../../operations/model/operation-types.js';
import type { ProviderService } from './provider-service.js';

/** Paid requests are operations, independent of any chat loop or mandatory model step. */
export class ModelInvocationService {
	constructor(
		private readonly model: ModelInvocationModel,
		private readonly content: OperationContentService,
		private readonly providers: ProviderService,
		private readonly artifacts: ArtifactService,
	) {}

	async describe(userId: number, selection: ModelInvocationSelection): Promise<ModelInvocationDescriptor> {
		const frozen = await this.model.resolve(userId, selection);
		return {
			protocol: frozen.protocol,
			contextWindow: frozen.capabilities.contextWindow ?? null,
			maxOutputTokens: frozen.capabilities.maxOutputTokens ?? null,
			supportsTools: frozen.capabilities.supportsTools,
			supportsImageInput: frozen.capabilities.supportsImageInput === true,
			reasoningEfforts: frozen.capabilities.reasoningEfforts?.map((effort) => effort) ?? [],
			chosenReasoningEffort: frozen.capabilities.defaultReasoningEffort ?? null,
		};
	}

	async invoke(input: ModelInvocationInput, context: ModelInvocationContext): Promise<ModelInvocationResult> {
		const argumentsJson = JSON.stringify(input);
		const result = await context.operation({
			intent: {
				scope: context.scope,
				callerId: context.callerId,
				parentId: context.parentId,
				operationKey: input.operationKey,
				requestHash: createHash('sha256').update(argumentsJson).digest('hex'),
			},
			signal: context.signal,

			prepare: async () => {
				const frozen = await this.model.resolve(context.scope.userId, input.model);
				const tools = await context.resolveTools(input.tools);
				if (
					frozen.protocol === 'images' ||
					(tools.length && !frozen.capabilities.supportsTools) ||
					(frozen.capabilities.maxOutputTokens !== undefined &&
						input.maxOutputTokens > frozen.capabilities.maxOutputTokens)
				) {
					throw new AgentFailure('invalid_input');
				}
				const messages = this.model.readMessages(
					await this.content.text(context.scope, input.messages, context.signal),
				);
				const images = messages.flatMap((message) =>
					message.role === 'user' && typeof message.content !== 'string'
						? message.content.filter((part) => part.type === 'image')
						: [],
				);
				if (images.length && !frozen.capabilities.supportsImageInput) {
					throw new AgentFailure('invalid_input');
				}

				const validate = async () => {
					await context.assertCurrent();
					await this.model.validate(context.scope.userId, frozen);
					await context.resolveTools(input.tools);
					if (images.length) {
						await context.assertArtifactAccess();
					}
				};

				return {
					record: true,
					kind: 'model',
					label: frozen.modelId,
					bindingJson: JSON.stringify({
						kind: 'model',
						providerId: frozen.providerId,
						providerVersion: frozen.providerVersion,
						credentialRevision: frozen.credentialRevision,
						modelId: frozen.modelId,
						tools: tools.map((tool) => ({
							name: tool.name,
							bindingId: tool.bindingId,
							inputSchemaSha256: createHash('sha256').update(tool.inputSchemaJson).digest('hex'),
						})),
					}),
					argumentsJson,
					mayHaveExternalEffect: true,
					validate,

					authorize: async () => {
						const authority = await context.authorize();
						authority.provider = {
							id: frozen.providerId,
							version: frozen.providerVersion,
							credentialRevision: frozen.credentialRevision,
						};
						const messageBytes = Buffer.byteLength(JSON.stringify(messages));
						const definitionBytes = Buffer.byteLength(JSON.stringify(tools));
						const tokens =
							Math.ceil((messageBytes + definitionBytes + Buffer.byteLength(input.systemPrompt)) / 4) +
							input.maxOutputTokens;
						if (!Number.isSafeInteger(tokens)) {
							throw new AgentFailure('limit_exceeded');
						}
						authority.modelReservation = { tokens };
						return authority;
					},

					execute: async (operation, signal) => {
						if (!operation) {
							throw new AgentFailure('internal_failure');
						}
						let admitted = false;
						const output = await this.providers
							.managedRequest(context.scope.userId, frozen.providerId, signal, async (requestSignal) => {
								admitted = true;
								try {
									return await this.useMessages(
										messages,
										operation,
										context,
										requestSignal,
										(prepared) =>
											this.model.invoke(
												context.scope.userId,
												{
													frozen,
													systemPrompt: input.systemPrompt,
													messages: prepared,
													tools,
													maxOutputTokens: input.maxOutputTokens,
												},
												requestSignal,
												(text) =>
													input.visible
														? context.onText(operation.id, text)
														: Promise.resolve(),
											),
									);
								} catch (error) {
									if (error instanceof ProviderRequestFailure) {
										context.reportFailure(error);
										throw new OperationEffectFailure(
											error.code,
											// A cancelled inference cannot dispatch tools. Keep its token reservation,
											// but a confirmed local stream close must not fence its parent as an unknown effect.
											error.outcome === 'rejected'
												? 'not_started'
												: signal.aborted && error.errorCode !== 'PROVIDER_STREAM_CLEANUP_FAILED'
													? 'confirmed'
													: 'unknown',
											error.errorCode === 'PROVIDER_STREAM_CLEANUP_FAILED' ? 'unknown' : 'closed',
											{ cause: error },
										);
									}
									throw error;
								}
							})
							.catch((error: unknown) => {
								if (!admitted) {
									throw new OperationEffectFailure(
										error instanceof AgentFailure ? error.code : 'internal_failure',
										'not_started',
										'closed',
										{ cause: error },
									);
								}
								throw error;
							});
						const body = await this.content.put(
							{
								userId: context.scope.userId,
								appId: context.scope.appId,
								runId: context.scope.runId,
								executionGeneration: context.scope.executionGeneration,
								operationId: operation.id,
							},
							context.callerId,
							'model-result:' + operation.id,
							'application/vnd.nexus.model-result+json',
							JSON.stringify(output.body),
							new AbortController().signal,
						);
						return JSON.stringify({
							operationId: operation.id,
							body,
							inputTokens: output.inputTokens,
							outputTokens: output.outputTokens,
						});
					},
				};
			},
		});
		if (result.kind !== 'receipt') {
			throw new AgentFailure('internal_failure');
		}
		if (result.receipt.state !== 'completed' || result.receipt.resultJson === null) {
			throw operationReceiptFailure(result.receipt, 'active_run_conflict');
		}
		const raw: unknown = JSON.parse(result.receipt.resultJson);
		const response = readAgentPluginModelResponse(raw);
		return {
			operationId: response.operationId,
			body: {
				id: response.body.id,
				sha256: response.body.sha256,
				sizeBytes: response.body.sizeBytes,
				mediaType: response.body.mediaType,
			},
			inputTokens: response.inputTokens,
			outputTokens: response.outputTokens,
		};
	}

	/** Keep actual read leases until the paid exchange has settled, including cancellation and cleanup. */
	private async useMessages<T>(
		messages: ModelInvocationMessage[],
		operation: OperationReceipt,
		context: ModelInvocationContext,
		signal: AbortSignal,
		consume: (messages: ModelInvocationPreparedMessage[]) => Promise<T>,
	): Promise<T> {
		const references = new Map<string, { artifactId: string; version: number; sha256: string }>();
		for (const message of messages) {
			if (message.role !== 'user' || typeof message.content === 'string') {
				continue;
			}
			for (const part of message.content) {
				if (part.type !== 'image') {
					continue;
				}
				const previous = references.get(part.artifactId);
				if (previous && (previous.version !== part.version || previous.sha256 !== part.sha256)) {
					throw new OperationEffectFailure('invalid_input', 'not_started', 'closed');
				}
				references.set(part.artifactId, {
					artifactId: part.artifactId,
					version: part.version,
					sha256: part.sha256,
				});
			}
		}
		const actor: ArtifactActor = {
			kind: 'tool',
			userId: context.scope.userId,
			appId: context.scope.appId,
			runId: context.scope.runId,
			operationId: operation.id,
			operationHash: operation.requestHash,
		};
		const contents = new Map<string, ArtifactContent>();
		const entries = [...references.values()];

		const withContent = async (index: number): Promise<T> => {
			if (index < entries.length) {
				await context.assertArtifactAccess();
				const ref = entries[index];
				return this.artifacts.useToolContent(
					actor,
					ref.artifactId,
					ref.version,
					ref.sha256,
					Number.MAX_SAFE_INTEGER,
					signal,
					async (content) => {
						contents.set(ref.artifactId, content);
						return withContent(index + 1);
					},
				);
			}
			if (entries.length) {
				await context.assertArtifactAccess();
			}
			signal.throwIfAborted();
			const prepared: ModelInvocationPreparedMessage[] = messages.map((message) => {
				if (message.role === 'user') {
					return {
						role: 'user',
						content:
							typeof message.content === 'string'
								? message.content
								: message.content.map((part) => {
										if (part.type === 'text') {
											return { type: 'text', text: part.text };
										}
										const content = contents.get(part.artifactId);
										if (
											!content ||
											(content.mediaType !== 'image/png' &&
												content.mediaType !== 'image/jpeg' &&
												content.mediaType !== 'image/webp' &&
												content.mediaType !== 'image/gif')
										) {
											throw new OperationEffectFailure('invalid_input', 'not_started', 'closed');
										}
										return { type: 'image', mediaType: content.mediaType, bytes: content.bytes };
									}),
					};
				}
				if (message.role === 'tool') {
					return { role: 'tool', callId: message.callId, content: message.content };
				}
				return {
					role: 'assistant',
					content: message.content,
					toolCalls: message.toolCalls.map((call) => ({
						id: call.id,
						name: call.name,
						argumentsJson: call.argumentsJson,
					})),
					reasoning: message.reasoning.map((item) => ({
						id: item.id,
						encryptedContent: item.encryptedContent,
						summary: item.summary.map((text) => text),
					})),
				};
			});
			return consume(prepared);
		};

		return withContent(0);
	}
}
