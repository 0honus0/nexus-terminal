import type { JsonValue } from '../../../agent.types';
import type { ToolResult, ToolUserSummary } from '../../../capabilities/tool.types';

export const MAX_URL_BYTES = 8 * 1024;
export const MAX_TYPE_BYTES = 16 * 1024;
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const MIN_SCREENSHOT_BYTES = 64 * 1024;
export const MAX_TRANSFER_BYTES = 8 * 1024 * 1024;
export const MAX_SETTLE_MS = 2_000;
export const MAX_WAIT_MS = 5_000;
export const MAX_SCROLL_DELTA = 10_000;
export const MAX_OPTION_BYTES = 512;
export const MAX_ID_BYTES = 128;
export const TOOL_VERSION = '1.0.0';

export const browserToolObject = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

export const browserToolString = (value: JsonValue | undefined, maxBytes: number, allowEmpty = false): string => {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    (!allowEmpty && !value.trim()) ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return allowEmpty ? value : value.trim();
};

export const browserToolInteger = (
  value: JsonValue | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) throw new Error('TOOL_ARGUMENTS_INVALID');
  return candidate;
};

export const browserToolStringArray = (
  value: JsonValue | undefined,
  options: { minItems: number; maxItems: number; maxBytes: number },
): string[] => {
  if (
    !Array.isArray(value) ||
    value.length < options.minItems ||
    value.length > options.maxItems ||
    value.some((item) => typeof item !== 'string' || Buffer.byteLength(item, 'utf8') > options.maxBytes)
  ) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value as string[];
};

export const browserToolResult = (summary: string, data?: JsonValue, userSummary?: ToolUserSummary): ToolResult => ({
  ok: true,
  summary,
  ...(userSummary ? { userSummary } : {}),
  ...(data === undefined ? {} : { data }),
  artifactRefs: [],
  truncated: false,
  outcome: 'confirmed',
  verification: {
    status: 'unverified',
    summary: 'Browser protocol completion is not independent verification of page-side effects.',
    evidenceRefs: [],
  },
});

export const browserByteSource = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes;
  })();
