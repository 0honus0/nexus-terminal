/** Private bounded journal representation; no public protocol or execution grant. */
export const CONTEXT_MAX_BYTES = 4 * 1024 * 1024;

export const CONTEXT_MAX_SOURCES = 4096;

export const CONTEXT_SNAPSHOT_MAX_BYTES = CONTEXT_MAX_BYTES + CONTEXT_MAX_SOURCES * 256;
