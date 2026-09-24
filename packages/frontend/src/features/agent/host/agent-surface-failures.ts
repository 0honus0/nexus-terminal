export interface AgentSurfaceFailure<TRetry = unknown> {
  domainKey: string;
  message: string;
  code: string;
  retry: TRetry | null;
}

export const upsertAgentSurfaceFailure = <TRetry>(
  failures: readonly AgentSurfaceFailure<TRetry>[],
  failure: AgentSurfaceFailure<TRetry>,
): AgentSurfaceFailure<TRetry>[] => [
  ...failures.filter((candidate) => candidate.domainKey !== failure.domainKey),
  failure,
];

export const clearAgentSurfaceFailure = <TRetry>(
  failures: readonly AgentSurfaceFailure<TRetry>[],
  domainKey: string,
): AgentSurfaceFailure<TRetry>[] => failures.filter((candidate) => candidate.domainKey !== domainKey);

export const clearAgentSurfaceFailures = <TRetry>(
  failures: readonly AgentSurfaceFailure<TRetry>[],
  domainKeys: readonly string[],
): AgentSurfaceFailure<TRetry>[] => {
  const targets = new Set(domainKeys);
  return failures.filter((candidate) => !targets.has(candidate.domainKey));
};

export const latestAgentSurfaceFailure = <TRetry>(
  failures: readonly AgentSurfaceFailure<TRetry>[],
): AgentSurfaceFailure<TRetry> | null => failures.at(-1) ?? null;
