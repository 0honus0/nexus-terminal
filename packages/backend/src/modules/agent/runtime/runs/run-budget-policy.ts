import type { AgentContextProfile } from '../../agent-defaults';
import type { RunBudget, RunContextPolicy, RunContextUsage } from './run.types';

const CONTEXT_POLICIES: Record<AgentContextProfile, RunContextPolicy> = {
  normal: {
    profile: 'normal',
    effectiveWindowPercent: 92,
    softPressurePercent: 80,
    toolOutputFloorPercent: 25,
  },
  extended: {
    profile: 'extended',
    effectiveWindowPercent: 96,
    softPressurePercent: 88,
    toolOutputFloorPercent: 40,
  },
};

const validPercent = (value: number): boolean => Number.isSafeInteger(value) && value >= 1 && value <= 100;
const percentOf = (value: number, percent: number): number => Math.max(1, Math.floor((value * percent) / 100));

const validateContextPolicy = (policy: RunContextPolicy): void => {
  if (
    !['normal', 'extended'].includes(policy.profile) ||
    !validPercent(policy.effectiveWindowPercent) ||
    !validPercent(policy.softPressurePercent) ||
    !validPercent(policy.toolOutputFloorPercent)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
};

export const freezeRunContextPolicy = (profile: AgentContextProfile): RunContextPolicy => {
  const policy = CONTEXT_POLICIES[profile];
  if (!policy) throw new Error('VALIDATION_FAILED');
  return { ...policy };
};

export interface ResolvedModelContextBudget {
  physicalInputTokens: number;
  effectiveInputTokens: number;
  softPressureTokens: number;
}

export const resolveModelContextBudget = (
  policy: RunContextPolicy,
  modelContextWindow: number,
  reservedOutputTokens: number,
): ResolvedModelContextBudget => {
  validateContextPolicy(policy);
  if (
    !Number.isSafeInteger(modelContextWindow) ||
    !Number.isSafeInteger(reservedOutputTokens) ||
    modelContextWindow < 2 ||
    reservedOutputTokens < 1 ||
    reservedOutputTokens >= modelContextWindow
  ) {
    throw new Error('VALIDATION_FAILED');
  }

  const physicalInputTokens = modelContextWindow - reservedOutputTokens;
  const effectiveInputTokens = Math.min(
    physicalInputTokens,
    percentOf(physicalInputTokens, policy.effectiveWindowPercent),
  );
  const softPressureTokens = Math.min(
    effectiveInputTokens,
    percentOf(effectiveInputTokens, policy.softPressurePercent),
  );
  return { physicalInputTokens, effectiveInputTokens, softPressureTokens };
};

export const pressureAdjustedToolOutputBytesForOccupancy = (
  budget: RunBudget,
  modelContextWindow: number,
  reservedOutputTokens: number,
  inputTokens: number,
): number => {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0) throw new Error('VALIDATION_FAILED');
  const maximum = budget.maxToolOutputBytes;
  const resolved = resolveModelContextBudget(budget.contextPolicy, modelContextWindow, reservedOutputTokens);
  if (inputTokens <= resolved.softPressureTokens) return maximum;

  const minimum = Math.max(1, percentOf(maximum, budget.contextPolicy.toolOutputFloorPercent));
  const pressureSpan = Math.max(1, resolved.effectiveInputTokens - resolved.softPressureTokens);
  const pressure = Math.min(pressureSpan, Math.max(0, inputTokens - resolved.softPressureTokens));
  const reduction = Math.floor(((maximum - minimum) * pressure) / pressureSpan);
  return Math.max(minimum, maximum - reduction);
};

export const pressureAdjustedToolOutputBytes = (budget: RunBudget, context?: RunContextUsage): number =>
  context
    ? pressureAdjustedToolOutputBytesForOccupancy(
        budget,
        context.contextWindowTokens,
        context.reservedOutputTokens,
        Math.max(context.inputTokens, context.heuristicInputTokens ?? 0),
      )
    : budget.maxToolOutputBytes;
