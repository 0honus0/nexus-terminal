/** Raw UTF-8 snapshot and its complete JSON envelope use different budgets. */
export const WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export const WORKSPACE_SUSPEND_MAX_JSON_BYTES = WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES * 6 + 16 * 1024;

export const WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES = 256 * 1024;

export const WORKSPACE_SUSPEND_MAX_NAME_CHARACTERS = 128;

export const SUSPENDED_SESSION_STATUSES = ['active', 'disconnected'] as const;

export type SuspendedSessionStatus = (typeof SUSPENDED_SESSION_STATUSES)[number];

export const SUSPENDED_OWNERSHIP_STATES = ['available', 'resuming', 'attached'] as const;

export type SuspendedOwnershipState = (typeof SUSPENDED_OWNERSHIP_STATES)[number];
