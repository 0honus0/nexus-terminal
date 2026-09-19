import type { SubagentProfileTemplate } from './subagent.types';

const templates: readonly SubagentProfileTemplate[] = [
  {
    id: 'explore',
    role: 'Repository explorer focused on bounded read-only codebase discovery.',
    delegationHint: 'Use for substantial repository exploration that can be isolated from the Root context.',
    capabilities: ['runs.execute', 'workspace.runtime.execute', 'machine.files.read', 'artifacts.read'],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    maxSteps: 12,
    failureMode: 'isolate',
  },
  {
    id: 'scout',
    role: 'Research scout focused on external, integration, and browser evidence.',
    delegationHint: 'Use for substantial independent research or evidence gathering that can run in parallel.',
    capabilities: ['runs.execute', 'integration.mcp.invoke', 'browser.operate', 'artifacts.read'],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    maxSteps: 12,
    failureMode: 'isolate',
  },
  {
    id: 'review',
    role: 'Read-only reviewer focused on diffs, tests, risks, and verification evidence.',
    delegationHint: 'Use for an independent review pass after enough implementation or evidence exists to inspect.',
    capabilities: ['runs.execute', 'workspace.runtime.execute', 'machine.files.read', 'artifacts.read'],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    maxSteps: 12,
    failureMode: 'isolate',
  },
  {
    id: 'general',
    role: 'General bounded child for substantial parallelizable analysis.',
    delegationHint: 'Use only when work is large enough to justify context isolation or parallel execution.',
    capabilities: ['runs.execute', 'workspace.runtime.execute', 'integration.mcp.invoke', 'artifacts.read'],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    maxSteps: 16,
    failureMode: 'isolate',
  },
  {
    id: 'worker',
    role: 'Governed coding worker for an explicitly bounded implementation assignment in its own Workspace.',
    delegationHint:
      'Use only for substantial implementation work with an explicit file/task boundary. Create and use a child-owned Workspace, run focused verification, and return durable evidence.',
    capabilities: ['runs.execute', 'workspace.runtime.manage', 'workspace.runtime.execute', 'artifacts.read'],
    peerMessaging: 'parent-child',
    mutationMode: 'governed',
    maxSteps: 24,
    failureMode: 'isolate',
  },
] as const;

export const builtInSubagentProfileTemplates = (maxSteps: number): SubagentProfileTemplate[] =>
  templates.map((template) => ({
    ...template,
    capabilities: [...template.capabilities],
    maxSteps: Math.min(template.maxSteps, maxSteps),
  }));
