import type { Scope } from '../agent.types';
import type { ModelProviderContinuation } from './model.types';

export interface ModelContinuationRef {
  runId: string;
  modelStepId: string;
}

export interface ModelStepContinuationView extends ModelContinuationRef {
  continuation: ModelProviderContinuation;
}

export interface ModelContinuationRepositoryPort {
  load(scope: Scope, refs: readonly ModelContinuationRef[]): Promise<ModelStepContinuationView[]>;
}
