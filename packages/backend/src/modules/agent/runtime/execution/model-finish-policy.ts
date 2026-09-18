import type { ModelFinishReason } from '../../ai/model.types';

export type ModelFinishDisposition =
  | { kind: 'complete' }
  | { kind: 'tool_calls' }
  | {
      kind: 'failed';
      errorCode:
        | 'MODEL_FINISH_REASON_MISSING'
        | 'MODEL_FINISH_REASON_MISMATCH'
        | 'MODEL_OUTPUT_TRUNCATED'
        | 'MODEL_CONTENT_FILTERED'
        | 'MODEL_PROVIDER_REPORTED_ERROR'
        | 'MODEL_FINISH_REASON_UNSUPPORTED';
    };

/**
 * Provider-neutral control policy for one completed model stream.
 *
 * `length` is intentionally terminal for now: the current model port has no provider continuation
 * state contract. P-077 may later add bounded continuation without changing the failure semantics
 * used when continuation cannot be constructed safely.
 */
export const modelFinishDisposition = (
  finishReason: ModelFinishReason | null,
  toolCallCount: number,
): ModelFinishDisposition => {
  if (finishReason === null) return { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_MISSING' };
  if (finishReason === 'stop') {
    return toolCallCount === 0 ? { kind: 'complete' } : { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_MISMATCH' };
  }
  if (finishReason === 'tool-calls') {
    return toolCallCount > 0 ? { kind: 'tool_calls' } : { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_MISMATCH' };
  }
  if (finishReason === 'length') return { kind: 'failed', errorCode: 'MODEL_OUTPUT_TRUNCATED' };
  if (finishReason === 'content-filter') return { kind: 'failed', errorCode: 'MODEL_CONTENT_FILTERED' };
  if (finishReason === 'error') return { kind: 'failed', errorCode: 'MODEL_PROVIDER_REPORTED_ERROR' };
  return { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_UNSUPPORTED' };
};
