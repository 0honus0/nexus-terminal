import type { ToolInspection } from './tool.types';

export type ToolPolicyDecision =
  | { action: 'allow'; policyRevision: number }
  | { action: 'requireApproval'; policyRevision: number; reason: string }
  | { action: 'deny'; policyRevision: number; reason: string };

export class PolicyService {
  decide(inspection: ToolInspection, currentPolicyRevision: number): ToolPolicyDecision {
    if (inspection.policyRevision !== currentPolicyRevision) {
      return { action: 'deny', policyRevision: currentPolicyRevision, reason: 'POLICY_REVISION_CONFLICT' };
    }
    if (inspection.risk === 'forbidden') {
      return { action: 'deny', policyRevision: currentPolicyRevision, reason: 'RESOURCE_FORBIDDEN' };
    }
    if (!inspection.mutation && (inspection.risk === 'read' || inspection.risk === 'control')) {
      return { action: 'allow', policyRevision: currentPolicyRevision };
    }
    if (inspection.mutation && (inspection.risk === 'mutate' || inspection.risk === 'destructive')) {
      return {
        action: 'requireApproval',
        policyRevision: currentPolicyRevision,
        reason: inspection.risk === 'destructive' ? 'DESTRUCTIVE_ACTION' : 'REMOTE_MUTATION',
      };
    }
    return { action: 'deny', policyRevision: currentPolicyRevision, reason: 'TOOL_POLICY_INVALID' };
  }
}
