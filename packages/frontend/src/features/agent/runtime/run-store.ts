import type { AgentRunSnapshot, AgentRunView } from '../api/agent-api';

interface StoredRun {
  latest: AgentRunView;
  snapshot: AgentRunSnapshot | null;
}

const isSnapshot = (run: AgentRunView): run is AgentRunSnapshot => 'recentEntries' in run;

const isMonotonicSuccessor = (current: AgentRunView, candidate: AgentRunView): boolean =>
  candidate.version >= current.version &&
  candidate.eventCursor >= current.eventCursor &&
  candidate.inputRevision >= current.inputRevision;

const sameProjection = (left: AgentRunView, right: AgentRunView): boolean =>
  left.version === right.version &&
  left.eventCursor === right.eventCursor &&
  left.inputRevision === right.inputRevision;

export const createAgentRunStore = () => {
  const runs = new Map<string, StoredRun>();

  const accept = (candidate: AgentRunView): AgentRunView => {
    const current = runs.get(candidate.id);
    if (current && !isMonotonicSuccessor(current.latest, candidate)) return current.latest;

    const snapshot = isSnapshot(candidate)
      ? candidate
      : current?.snapshot && sameProjection(current.snapshot, candidate)
        ? current.snapshot
        : null;
    runs.set(candidate.id, { latest: candidate, snapshot });
    return candidate;
  };

  const acceptSnapshot = (candidate: AgentRunSnapshot): AgentRunSnapshot | null => {
    const accepted = accept(candidate);
    const current = runs.get(candidate.id);
    if (!current || !sameProjection(accepted, candidate)) return current?.snapshot ?? null;
    current.snapshot = candidate;
    return candidate;
  };

  const latest = (runId: string): AgentRunView | null => runs.get(runId)?.latest ?? null;

  const currentSnapshot = (runId: string): AgentRunSnapshot | null => {
    const current = runs.get(runId);
    if (!current?.snapshot || !sameProjection(current.latest, current.snapshot)) return null;
    return current.snapshot;
  };

  const clear = (): void => runs.clear();

  return { accept, acceptSnapshot, latest, currentSnapshot, clear };
};
