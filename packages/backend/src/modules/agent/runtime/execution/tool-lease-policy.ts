const MIN_TOOL_LEASE_TTL_SECONDS = 30;
const MAX_TOOL_LEASE_TTL_SECONDS = 300;
const TOOL_LEASE_GRACE_SECONDS = 15;

/** Agent Tool leases track the frozen per-Run Tool timeout plus bounded renewal grace. */
export const toolLeaseTtlSeconds = (toolTimeoutSeconds: number): number =>
  Math.min(
    MAX_TOOL_LEASE_TTL_SECONDS,
    Math.max(MIN_TOOL_LEASE_TTL_SECONDS, toolTimeoutSeconds + TOOL_LEASE_GRACE_SECONDS),
  );
