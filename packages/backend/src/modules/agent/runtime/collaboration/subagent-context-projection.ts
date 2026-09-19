import type { JsonValue } from '../../agent.types';
import { boundedUtf8 } from '../execution/text-budget';
import type { DelegationView, SubagentSettingsView } from './subagent.types';

const MAX_COLLABORATION_BYTES = 8 * 1024;
const MAX_PROFILE_MANIFEST = 16;
const MAX_CAPABILITIES_PER_PROFILE = 12;
const MAX_EVIDENCE_REFS = 16;

const compactJson = (value: JsonValue | null, maxBytes: number): string | null =>
  value === null ? null : boundedUtf8(JSON.stringify(value), maxBytes);

const encodedBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

export const projectSubagentCollaborationContext = (
  settings: SubagentSettingsView | null,
  directSubagents: readonly DelegationView[],
): string | undefined => {
  if (!settings && directSubagents.length === 0) return undefined;
  const profiles = settings?.policy.profiles ?? [];
  const templates = settings?.templates ?? [];
  const activeDirectChildren = directSubagents.filter(
    (delegation) => !['completed', 'failed', 'cancelled'].includes(delegation.status),
  ).length;
  const profileViews = profiles.slice(0, MAX_PROFILE_MANIFEST).map((profile) => ({
    id: profile.id,
    role: boundedUtf8(profile.role, 256),
    maxSteps: profile.maxSteps,
    peerMessaging: profile.peerMessaging,
    mutationMode: profile.mutationMode,
    failureMode: profile.failureMode,
    capabilities: profile.capabilities.slice(0, MAX_CAPABILITIES_PER_PROFILE),
    defaultModel: profile.defaultModel,
  }));
  const templateViews = templates.map((template) => ({
    id: template.id,
    role: boundedUtf8(template.role, 192),
    delegationHint: boundedUtf8(template.delegationHint, 256),
    maxSteps: template.maxSteps,
    capabilities: template.capabilities.slice(0, MAX_CAPABILITIES_PER_PROFILE),
    mutationMode: template.mutationMode,
    presetOnly: true,
  }));
  const delegationViews = directSubagents.map((delegation) => ({
    delegationId: delegation.id,
    childRuntimeId: delegation.childRuntimeId,
    profileId: delegation.profileId,
    mutationMode: delegation.mutationMode,
    modelRef: delegation.modelRef,
    objective: boundedUtf8(delegation.objective, 512),
    status: delegation.status,
    budget: delegation.budget,
    usage: delegation.usage,
    result: compactJson(delegation.result, 1_024),
    evidenceRefs: delegation.evidenceRefs.slice(0, MAX_EVIDENCE_REFS),
    deadlineAt: delegation.deadlineAt,
  }));
  const projection = {
    guidance: [
      'Delegate only when work is substantial, parallelizable, or would isolate a large retrieval/review context. Handle small local tasks in the Root agent.',
      'Only configuredProfiles are executable profileId values. Built-in templates are configuration presets until copied and saved for this App.',
      'Governed mutation profiles are for substantial coding assignments only. They expose Workspace mutations only on Full Access Runs; each worker must use a Workspace owned by its own child runtime and return verification/evidence.',
      'Pass a narrow objective, explicit constraints, only necessary Artifact refs, and a bounded step/deadline envelope. Child agents do not inherit the Root raw conversation or Recall.',
      'Treat this durable projection as the current child lifecycle truth; use collaboration tools for fresh detail instead of relying on memory of earlier spawn calls.',
    ],
    capacity: {
      maxDelegationDepth: settings?.policy.maxDelegationDepth ?? null,
      configuredProfileCount: profiles.length,
      directChildren: directSubagents.length,
      activeDirectChildren,
    },
    configuredProfiles: [] as typeof profileViews,
    omittedConfiguredProfiles: profiles.length,
    templateCatalog: [] as typeof templateViews,
    omittedTemplates: templates.length,
    directDelegations: [] as typeof delegationViews,
    omittedDirectDelegations: directSubagents.length,
  };

  const appendWithinBudget = <T>(
    target: T[],
    item: T,
    decrementOmitted: () => void,
    restoreOmitted: () => void,
  ): void => {
    target.push(item);
    decrementOmitted();
    if (encodedBytes(projection) <= MAX_COLLABORATION_BYTES) return;
    target.pop();
    restoreOmitted();
  };

  for (const profile of profileViews) {
    appendWithinBudget(
      projection.configuredProfiles,
      profile,
      () => {
        projection.omittedConfiguredProfiles -= 1;
      },
      () => {
        projection.omittedConfiguredProfiles += 1;
      },
    );
  }
  for (const delegation of delegationViews) {
    appendWithinBudget(
      projection.directDelegations,
      delegation,
      () => {
        projection.omittedDirectDelegations -= 1;
      },
      () => {
        projection.omittedDirectDelegations += 1;
      },
    );
  }
  for (const template of templateViews) {
    appendWithinBudget(
      projection.templateCatalog,
      template,
      () => {
        projection.omittedTemplates -= 1;
      },
      () => {
        projection.omittedTemplates += 1;
      },
    );
  }

  return JSON.stringify(projection);
};
