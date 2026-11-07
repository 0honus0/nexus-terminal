import type { ModelMessage, ModelNetworkPort } from '../../../../platform/ai/model-port.js';
import { modelTextBatches } from '../../../../platform/ai/model-text-batches.js';
import { AgentFailure, ProviderRequestFailure } from '../../agent-failure.js';
import type { ProviderModel } from './provider-model.js';
import type { FrozenModelInput } from './provider-types.js';
import type {
	ModelInvocationCommand,
	ModelInvocationMessage,
	ModelInvocationPreparedMessage,
	ModelInvocationOutput,
	ModelInvocationSelection,
} from './model-invocation-types.js';
import { resolveFrozenModel } from '../provider-capability-rules.js';
import { toProviderRequestFailure } from './provider-network-failure.js';
import { readAgentPluginModelMessages } from '@nexus-terminal/shared/agent/plugins/app-runtime';
import { OperationEffectFailure } from '../../operations/model/operation-failure.js';

function message(value: ModelInvocationPreparedMessage): ModelMessage {
	if (value.role === 'user') {
		return {
			role: 'user',
			content:
				typeof value.content === 'string'
					? value.content
					: value.content.map((part) =>
							part.type === 'text'
								? { type: 'text', text: part.text }
								: { type: 'image', mediaType: part.mediaType, bytes: part.bytes },
						),
		};
	}
	if (value.role === 'tool') {
		return { role: 'tool', callId: value.callId, content: value.content };
	}
	return {
		role: 'assistant',
		content: value.content,
		toolCalls: value.toolCalls.map((call) => ({ id: call.id, name: call.name, argumentsJson: call.argumentsJson })),
		reasoning: value.reasoning.map((item) => ({
			id: item.id,
			encryptedContent: item.encryptedContent,
			summary: item.summary.map((text) => text),
		})),
	};
}

/** A single technical model exchange; this owner never chooses the next App step. */
export class ModelInvocationModel {
	constructor(
		private readonly providers: ProviderModel,
		private readonly network: ModelNetworkPort,
	) {}

	async resolve(userId: number, selection: ModelInvocationSelection): Promise<FrozenModelInput> {
		const provider = await this.providers.get(userId, selection.providerId);
		if (!provider) {
			throw new AgentFailure('not_found');
		}
		const frozen = resolveFrozenModel(provider, {
			providerId: selection.providerId,
			modelId: selection.modelId,
			configurationVersion: selection.configurationVersion,
			...(selection.reasoningEffort === null ? {} : { reasoningEffort: selection.reasoningEffort }),
		});
		if (!frozen) {
			throw new AgentFailure('provider_configuration_stale');
		}
		return frozen;
	}

	readMessages(json: string): ModelInvocationMessage[] {
		const input: unknown = JSON.parse(json);
		return readAgentPluginModelMessages(input).map((value) =>
			value.role === 'user'
				? {
						role: 'user',
						content:
							typeof value.content === 'string'
								? value.content
								: value.content.map((part) =>
										part.type === 'text'
											? { type: 'text', text: part.text }
											: {
													type: 'image',
													artifactId: part.artifactId,
													version: part.version,
													sha256: part.sha256,
												},
									),
					}
				: value.role === 'tool'
					? { role: 'tool', callId: value.callId, content: value.content }
					: {
							role: 'assistant',
							content: value.content,
							toolCalls: value.toolCalls.map((call) => ({
								id: call.id,
								name: call.name,
								argumentsJson: call.argumentsJson,
							})),
							reasoning: value.reasoning.map((item) => ({
								id: item.id,
								encryptedContent: item.encryptedContent,
								summary: item.summary.map((text) => text),
							})),
						},
		);
	}

	async validate(userId: number, frozen: FrozenModelInput): Promise<void> {
		const provider = await this.providers.get(userId, frozen.providerId);
		if (
			!provider ||
			provider.version !== frozen.providerVersion ||
			provider.credentialRevision !== frozen.credentialRevision
		) {
			throw new AgentFailure('provider_configuration_stale');
		}
		await this.providers.guardCurrent(provider);
	}

	async invoke(
		userId: number,
		command: ModelInvocationCommand,
		signal: AbortSignal,
		onText: (text: string) => Promise<void>,
	): Promise<ModelInvocationOutput> {
		const frozen = command.frozen;
		let credential: string | null;
		try {
			const provider = await this.providers.get(userId, frozen.providerId);
			if (
				!provider ||
				provider.version !== frozen.providerVersion ||
				provider.credentialRevision !== frozen.credentialRevision
			) {
				throw new AgentFailure('provider_configuration_stale');
			}
			credential = await this.providers.credential(provider);
			await this.providers.guardCurrent(provider);
			signal.throwIfAborted();
		} catch (error) {
			throw new OperationEffectFailure(
				error instanceof AgentFailure ? error.code : 'internal_failure',
				'not_started',
				'closed',
				{ cause: error },
			);
		}
		const controller = new AbortController();
		const parts: string[] = [];
		let result: ModelInvocationOutput | null = null;
		let usage: { inputTokens: number; outputTokens: number } | null = null;
		try {
			const events = modelTextBatches(
				this.network.stream(
					{
						baseUrl: frozen.baseUrl,
						protocol: frozen.protocol,
						modelId: frozen.modelId,
						credential,
						systemPrompt: command.systemPrompt,
						maxOutputTokens: command.maxOutputTokens,
						usesReasoning: Boolean(frozen.capabilities.reasoningEfforts?.length),
						...(frozen.capabilities.defaultReasoningEffort === undefined
							? {}
							: {
									reasoningEffort: frozen.capabilities.defaultReasoningEffort,
								}),
						messages: command.messages.map(message),
						tools: command.tools.map((tool) => ({
							name: tool.name,
							description: tool.description,
							parameters: { schemaJson: tool.inputSchemaJson },
						})),
					},
					AbortSignal.any([signal, controller.signal]),
				),
				() => controller.abort(),
				signal,
			);
			for await (const event of events) {
				signal.throwIfAborted();
				if (result) {
					throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
				}
				if (event.type === 'text_delta') {
					if (event.text) {
						parts.push(event.text);
						await onText(event.text);
					}
					continue;
				}
				if (event.type === 'usage') {
					if (
						usage ||
						!Number.isSafeInteger(event.inputTokens) ||
						event.inputTokens < 0 ||
						!Number.isSafeInteger(event.outputTokens) ||
						event.outputTokens < 0
					) {
						throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
					}
					usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
					continue;
				}
				if (event.finishReason !== 'stop' && event.finishReason !== 'tool_calls') {
					throw new ProviderRequestFailure(
						event.finishReason === 'length' ? 'PROVIDER_RESPONSE_TOO_LARGE' : 'PROVIDER_CONTENT_FILTERED',
					);
				}

				const calls = event.finishReason === 'tool_calls' ? event.toolCalls : [];
				if (
					(event.finishReason === 'tool_calls' && calls.length === 0) ||
					new Set(calls.map((call) => call.id)).size !== calls.length
				) {
					throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
				}
				const toolCalls = calls.map((call) => {
					const tool = command.tools.find((tool) => tool.name === call.name);
					if (!tool) {
						throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
					}
					return {
						id: call.id,
						name: call.name,
						argumentsJson: call.argumentsJson,
						bindingId: tool.bindingId,
					};
				});
				result = {
					body: {
						text: parts.join(''),
						finishReason: event.finishReason,
						toolCalls,
						reasoning: event.reasoning.map((item) => ({
							id: item.id,
							encryptedContent: item.encryptedContent,
							summary: item.summary.map((text) => text),
						})),
					},
					inputTokens: usage?.inputTokens ?? null,
					outputTokens: usage?.outputTokens ?? null,
				};
			}
			if (!result) {
				throw new ProviderRequestFailure('PROVIDER_STREAM_TRUNCATED');
			}
			return result;
		} catch (error) {
			throw toProviderRequestFailure(error);
		} finally {
			controller.abort();
		}
	}
}
