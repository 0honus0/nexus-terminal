import type { CompletionEvidenceSnapshot } from '../runs/run.repository.port';
import type { RunSnapshot } from '../runs/run.types';

const EXECUTION_EVIDENCE_TOOLS = new Set(['workspace_execute_argv', 'workspace_job', 'machine_execute_shell']);
const EXPLICIT_VERIFICATION_REQUEST =
  /(?:\b(?:test|tests|testing|build|compile|lint|typecheck|type-check|check|verify|verification|pytest|vitest|jest)\b|测试|构建|编译|检查|验证)/i;

export type CompletionGateDecision =
  | { kind: 'complete'; terminalStatus: 'completed' | 'completed_unverified'; summary: string }
  | { kind: 'continue'; reasonCode: 'COMPLETION_PLAN_INCOMPLETE' | 'COMPLETION_EVIDENCE_REQUIRED'; notice: string }
  | { kind: 'failed'; errorCode: 'COMPLETION_GATE_UNSATISFIED'; notice: string };

const confirmedSuccess = (result: CompletionEvidenceSnapshot['tools'][number]['result']): boolean =>
  result.ok && result.outcome === 'confirmed';

const verified = (result: CompletionEvidenceSnapshot['tools'][number]['result']): boolean =>
  confirmedSuccess(result) && result.verification.status === 'verified';

const repeatedGateFailure = (
  evidence: CompletionEvidenceSnapshot,
  reasonCode: 'COMPLETION_PLAN_INCOMPLETE' | 'COMPLETION_EVIDENCE_REQUIRED',
  notice: string,
): CompletionGateDecision =>
  evidence.gateBlocksSinceToolProgress > 0
    ? { kind: 'failed', errorCode: 'COMPLETION_GATE_UNSATISFIED', notice }
    : { kind: 'continue', reasonCode, notice };

export const completionGateDecision = (
  run: RunSnapshot,
  evidence: CompletionEvidenceSnapshot,
  objectiveText: string,
): CompletionGateDecision => {
  if (run.definition.executionMode === 'plan') {
    if (evidence.tools.some((item) => item.inspection.mutation && confirmedSuccess(item.result))) {
      return {
        kind: 'failed',
        errorCode: 'COMPLETION_GATE_UNSATISFIED',
        notice: 'Plan-only Run produced mutation evidence, which violates the frozen execution mode.',
      };
    }
    if (run.plan.items.length === 0) {
      return repeatedGateFailure(
        evidence,
        'COMPLETION_PLAN_INCOMPLETE',
        'Completion gate blocked: plan-only Run must produce a durable user-visible plan before completing.',
      );
    }
    return {
      kind: 'complete',
      terminalStatus: 'completed_unverified',
      summary: 'Plan-only Run produced a durable plan; execution remains pending user confirmation in a separate Run.',
    };
  }
  const unfinishedPlanItems = run.plan.items.filter((item) =>
    ['pending', 'in_progress', 'blocked'].includes(item.status),
  );
  if (unfinishedPlanItems.length > 0) {
    const ids = unfinishedPlanItems
      .slice(0, 8)
      .map((item) => item.id)
      .join(', ');
    return repeatedGateFailure(
      evidence,
      'COMPLETION_PLAN_INCOMPLETE',
      `Completion gate blocked: the durable Run plan still has unfinished item(s): ${ids}. Finish, cancel, or update those items before completing the Run.`,
    );
  }

  const readyEvidence = new Set(evidence.readyEvidenceRefs);
  const hasPlanEvidence = run.plan.items.some(
    (item) => item.status === 'completed' && item.evidenceRefs.some((ref) => readyEvidence.has(ref)),
  );
  const successfulMutations = evidence.tools.filter(
    (item) => item.inspection.mutation && confirmedSuccess(item.result),
  );
  if (successfulMutations.length === 0) {
    return hasPlanEvidence
      ? { kind: 'complete', terminalStatus: 'completed', summary: 'Completed Plan evidence is durable and available.' }
      : {
          kind: 'complete',
          terminalStatus: 'completed_unverified',
          summary: 'No external mutation evidence was required for this Run.',
        };
  }

  const latestMutationStep = Math.max(...successfulMutations.map((item) => item.stepIndex));
  const requiresExecutionEvidence = EXPLICIT_VERIFICATION_REQUEST.test(objectiveText);
  const verifiedAfterMutation = evidence.tools.filter(
    (item) => item.stepIndex > latestMutationStep && verified(item.result) && item.toolName !== 'plan_update',
  );
  const verifiedExecution = evidence.tools.filter(
    (item) =>
      item.stepIndex >= latestMutationStep && EXECUTION_EVIDENCE_TOOLS.has(item.toolName) && verified(item.result),
  );
  const hasRequiredEvidence = requiresExecutionEvidence
    ? verifiedExecution.length > 0 || hasPlanEvidence
    : verifiedAfterMutation.length > 0 || verifiedExecution.length > 0 || hasPlanEvidence;

  if (!hasRequiredEvidence) {
    const expectation = requiresExecutionEvidence
      ? 'Run an appropriate test/build/check command and obtain a verified successful result.'
      : 'Obtain verified follow-up evidence for the mutation (for example a read/check/execute result), or attach durable Plan evidence.';
    return repeatedGateFailure(
      evidence,
      'COMPLETION_EVIDENCE_REQUIRED',
      `Completion gate blocked: this Run changed external state but does not yet have sufficient durable completion evidence. ${expectation}`,
    );
  }

  return {
    kind: 'complete',
    terminalStatus: 'completed',
    summary: requiresExecutionEvidence
      ? 'Verified execution evidence satisfied the requested completion check.'
      : 'Durable verification evidence exists after the Run mutation.',
  };
};
