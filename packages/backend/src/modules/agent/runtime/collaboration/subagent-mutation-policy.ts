import type { ToolInspection } from '../../capabilities/tool.types';

export const governedSubagentWorkspaceMutation = (
  inspection: ToolInspection,
  runId: string,
  runtimeId: string,
): boolean => {
  if (
    !inspection.mutation ||
    !['mutate', 'destructive'].includes(inspection.risk) ||
    inspection.target.kind !== 'workspace'
  ) {
    return false;
  }

  const workspaceId = inspection.target.workspaceId;
  const generation = inspection.target.generation;
  if (workspaceId === undefined && generation === undefined) {
    const pendingWorkspace = `workspace:new:${runId}:${runtimeId}`;
    return (
      inspection.target.targetIdentity === pendingWorkspace &&
      inspection.target.endpoint === 'workspace:new' &&
      inspection.resourceKeys.includes(pendingWorkspace)
    );
  }
  if (
    typeof workspaceId !== 'string' ||
    workspaceId.length < 1 ||
    !Number.isSafeInteger(generation) ||
    Number(generation) < 1
  ) {
    return false;
  }

  const workspaceResource = `workspace:${workspaceId}:${generation}`;
  return (
    inspection.target.endpoint === `workspace:${workspaceId}` &&
    (inspection.target.targetIdentity === workspaceResource ||
      inspection.target.targetIdentity.startsWith(`${workspaceResource}:`)) &&
    inspection.resourceKeys.some(
      (resourceKey) => resourceKey === workspaceResource || resourceKey.startsWith(`${workspaceResource}:`),
    )
  );
};
