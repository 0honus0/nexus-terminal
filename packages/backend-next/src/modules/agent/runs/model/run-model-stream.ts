import { AGENT_RUN_STEP_MAX_TEXT_BYTES } from '@nexus-terminal/shared/agent/runs/values';
import type { ModelNetworkPort } from '../../../../platform/ai/model-port.js';
import { toProviderRequestFailure } from '../../providers/model/provider-network-failure.js';
import { AgentFailure, ProviderRequestFailure } from '../../agent-failure.js';
import type { RunFrozenInput, RunModelDelta } from './run-types.js';

export class RunModelStream {
	constructor(private readonly network: ModelNetworkPort) {}

	/**
	 * Only the future authorized Run executor may call this method. Neither a
	 * Provider probe nor a frozen model reference is itself execution approval.
	 * The Run owner must persist an attempt before dispatch and must not retry
	 * requests whose dispatch/result is unknown.
	 */
	async *stream(
		frozen: RunFrozenInput,
		prompt: string,
		credential: string | null,
		signal: AbortSignal,
	): AsyncIterable<RunModelDelta> {
		if (frozen.executionPolicy === 'awaiting_b6_b7') {
			throw new AgentFailure('provider_unavailable');
		}
		if (signal.aborted) {
			throw new ProviderRequestFailure('PROVIDER_NETWORK_TIMEOUT');
		}
		try {
			let completed = false;
			let hasUsage = false;
			let hasVisibleText = false;
			let textBytes = 0;
			const events = this.network.stream(
				{
					baseUrl: frozen.baseUrl,
					protocol: frozen.protocol,
					modelId: frozen.modelId,
					credential,
					maxOutputTokens: frozen.capabilities.maxOutputTokens,
					usesReasoning: Boolean(frozen.capabilities.reasoningEfforts?.length),
					...(frozen.capabilities.defaultReasoningEffort === undefined
						? {}
						: { reasoningEffort: frozen.capabilities.defaultReasoningEffort }),
					prompt,
				},
				signal,
			);
			for await (const event of events) {
				if (signal.aborted) {
					throw new ProviderRequestFailure('PROVIDER_NETWORK_TIMEOUT');
				}
				if (completed) {
					throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
				}
				if (event.type === 'text_delta') {
					if (typeof event.text !== 'string') {
						throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
					}
					// Model→RunStep is a real boundary: the journal cannot persist
					// zero-byte deltas. A custom technical Port may emit empty
					// content even though the installed SSE Decoder filters it.
					if (event.text.length === 0) {
						continue;
					}
					textBytes += Buffer.byteLength(event.text, 'utf8');
					if (textBytes > AGENT_RUN_STEP_MAX_TEXT_BYTES) {
						throw new ProviderRequestFailure('PROVIDER_RESPONSE_TOO_LARGE');
					}
					if (event.text.trim()) {
						hasVisibleText = true;
					}
					yield { kind: 'text', content: event.text };
				} else if (event.type === 'usage') {
					if (
						hasUsage ||
						!Number.isSafeInteger(event.inputTokens) ||
						!Number.isSafeInteger(event.outputTokens) ||
						event.inputTokens < 0 ||
						event.outputTokens < 0
					) {
						throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
					}
					hasUsage = true;
					yield { kind: 'usage', inputTokens: event.inputTokens, outputTokens: event.outputTokens };
				} else if (event.type === 'completed') {
					if (event.finishReason !== 'stop') {
						throw new ProviderRequestFailure(
							event.finishReason === 'length' ? 'PROVIDER_OUTPUT_TRUNCATED' : 'PROVIDER_CONTENT_FILTERED',
						);
					}
					completed = true;
				} else {
					throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
				}
			}
			// A transport's completed event is not sufficient. Its iterator must
			// also finish normally (including reader cleanup) before success can
			// reach the Run owner or be persisted as the authoritative terminal.
			if (signal.aborted) {
				throw new ProviderRequestFailure('PROVIDER_NETWORK_TIMEOUT');
			}
			if (!completed) {
				throw new ProviderRequestFailure('PROVIDER_STREAM_TRUNCATED');
			}
			if (!hasVisibleText) {
				throw new ProviderRequestFailure('PROVIDER_RESPONSE_EMPTY');
			}
			yield { kind: 'finished', finishReason: 'stop' };
		} catch (error) {
			// SQL writes occur in the execution owner, outside this technical iterator.
			// Mapping a transport failure cannot trigger a retry of an unknown DB commit.
			throw toProviderRequestFailure(error);
		}
	}
}
