import { createHash } from 'node:crypto';
import type { JsonValue } from '../agent.types';
import type { ToolResult } from './tool.types';

const HIGH_SIGNAL_PATTERN =
  /\b(error|fatal|fail(?:ed|ure)?|exception|traceback|panic|warning|warn|denied|invalid|not found|timeout|timed out|exit(?:ed)?(?: code)?|assert(?:ion)?)\b/i;

const jsonBytes = (value: JsonValue | ToolResult): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

const truncateJsonString = (value: string, maxBytes: number): string => {
  if (maxBytes <= 2) return '';
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes) return value;
  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  let best = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join('')}…`;
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= maxBytes) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
};

const boundedSegment = (value: string, maxCharacters: number): string => {
  const characters = Array.from(value);
  if (characters.length <= maxCharacters) return value;
  return `${characters.slice(0, Math.max(0, maxCharacters - 1)).join('')}…`;
};

const projectText = (value: string, maxBytes: number): string => {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes) return value;
  const lines = value.split(/\r?\n/);
  const signals = lines.filter((line) => HIGH_SIGNAL_PATTERN.test(line));
  let head = boundedSegment(lines.slice(0, 8).join('\n'), Math.max(48, Math.floor(maxBytes * 0.22)));
  let signal = boundedSegment(
    signals.slice(-8).join('\n'),
    Math.max(64, Math.floor(maxBytes * 0.3)),
  );
  let tail = boundedSegment(lines.slice(-8).join('\n'), Math.max(48, Math.floor(maxBytes * 0.22)));
  let candidate = [
    '[head]',
    head,
    ...(signal ? ['[high-signal]', signal] : []),
    '[tail]',
    tail,
  ].join('\n');
  let guard = 0;
  while (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > maxBytes && guard < 12) {
    head = boundedSegment(head, Math.max(16, Math.floor(Array.from(head).length * 0.8)));
    signal = boundedSegment(signal, Math.max(24, Math.floor(Array.from(signal).length * 0.8)));
    tail = boundedSegment(tail, Math.max(16, Math.floor(Array.from(tail).length * 0.8)));
    candidate = [
      '[head]',
      head,
      ...(signal ? ['[high-signal]', signal] : []),
      '[tail]',
      tail,
    ].join('\n');
    guard += 1;
  }
  if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= maxBytes) return candidate;
  const fallback = signal
    ? `[high-signal]\n${signal}\n[tail]\n${tail}`
    : `[head]\n${head}\n[tail]\n${tail}`;
  return truncateJsonString(fallback, maxBytes);
};

const jsonProjectionPriority = (key: string, value: JsonValue): number => {
  if (/^(error|errorCode|errors|status|outcome|exitCode|code|message|summary|stderr)$/i.test(key)) return -2;
  if (/^(artifactRef|artifactRefs|evidenceRef|evidenceRefs|hash|sha256|size|bytes)$/i.test(key)) return -1;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return 0;
  if (typeof value === 'string') return 1;
  if (Array.isArray(value)) return 3;
  return 2;
};

const projectJsonValue = (value: JsonValue, maxBytes: number): JsonValue => {
  if (maxBytes < 4) return null;
  if (jsonBytes(value) <= maxBytes) return value;
  if (typeof value === 'string') return projectText(value, maxBytes);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const projected: JsonValue[] = [];
    const headCount = Math.min(value.length, 4);
    for (let index = 0; index < headCount; index += 1) {
      const remaining = maxBytes - jsonBytes(projected) - 1;
      if (remaining < 4) break;
      const candidate = [...projected, projectJsonValue(value[index]!, remaining)];
      if (jsonBytes(candidate) > maxBytes) break;
      projected.push(candidate[candidate.length - 1]!);
    }
    if (value.length > headCount) {
      for (const item of value.slice(-2)) {
        const remaining = maxBytes - jsonBytes(projected) - 1;
        if (remaining < 4) break;
        const candidate = [...projected, projectJsonValue(item, remaining)];
        if (jsonBytes(candidate) > maxBytes) break;
        projected.push(candidate[candidate.length - 1]!);
      }
    }
    return projected;
  }
  const projected: Record<string, JsonValue> = {};
  const entries = Object.entries(value)
    .map(([key, item], index) => ({ key, item, index }))
    .sort(
      (left, right) =>
        jsonProjectionPriority(left.key, left.item) - jsonProjectionPriority(right.key, right.item) ||
        left.index - right.index,
    );
  for (const { key, item } of entries) {
    const currentBytes = jsonBytes(projected as JsonValue);
    const keyOverhead = Buffer.byteLength(JSON.stringify(key), 'utf8') + 2;
    const remaining = maxBytes - currentBytes - keyOverhead;
    if (remaining < 4) continue;
    const candidate = { ...projected, [key]: projectJsonValue(item, remaining) };
    if (jsonBytes(candidate as JsonValue) <= maxBytes) projected[key] = candidate[key]!;
  }
  return projected;
};

const appendRefsWithinBudget = (
  base: ToolResult,
  refs: readonly string[],
  field: 'artifactRefs' | 'evidenceRefs',
  maxBytes: number,
): ToolResult => {
  let current = base;
  for (const ref of refs) {
    const candidate: ToolResult =
      field === 'artifactRefs'
        ? { ...current, artifactRefs: [...current.artifactRefs, ref] }
        : {
            ...current,
            verification: { ...current.verification, evidenceRefs: [...current.verification.evidenceRefs, ref] },
          };
    if (jsonBytes(candidate) > maxBytes) break;
    current = candidate;
  }
  return current;
};

/**
 * Build the bounded ToolResult sent back to the model. The caller remains responsible for
 * persisting the unmodified ToolResult as execution evidence.
 */
export const projectToolResult = (result: ToolResult, maxOutputBytes: number): ToolResult => {
  const encoded = JSON.stringify(result);
  const originalBytes = Buffer.byteLength(encoded, 'utf8');
  if (originalBytes <= maxOutputBytes) return result;
  const projection = {
    originalBytes,
    sha256: createHash('sha256').update(encoded, 'utf8').digest('hex'),
  };
  const minimal: ToolResult = {
    ok: result.ok,
    summary: '',
    artifactRefs: [],
    truncated: true,
    outcome: result.outcome,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    projection,
    verification: {
      status: result.verification.status,
      summary: '',
      evidenceRefs: [],
    },
  };
  const effectiveLimit = Math.max(maxOutputBytes, jsonBytes(minimal));
  let projected = appendRefsWithinBudget(minimal, result.artifactRefs, 'artifactRefs', effectiveLimit);
  projected = appendRefsWithinBudget(projected, result.verification.evidenceRefs, 'evidenceRefs', effectiveLimit);

  const summaryBudget = Math.min(4096, Math.max(48, Math.floor(effectiveLimit * 0.14)));
  let candidate: ToolResult = { ...projected, summary: projectText(result.summary, summaryBudget) };
  if (jsonBytes(candidate) <= effectiveLimit) projected = candidate;

  const verificationBudget = Math.min(2048, Math.max(48, Math.floor(effectiveLimit * 0.1)));
  candidate = {
    ...projected,
    verification: {
      ...projected.verification,
      summary: projectText(result.verification.summary, verificationBudget),
    },
  };
  if (jsonBytes(candidate) <= effectiveLimit) projected = candidate;

  if (result.data !== undefined) {
    const envelopeBytes = jsonBytes(projected);
    const dataBudget = Math.max(4, effectiveLimit - envelopeBytes - Buffer.byteLength(',"data":', 'utf8') - 2);
    const data = projectJsonValue(result.data, dataBudget);
    candidate = { ...projected, data };
    if (jsonBytes(candidate) <= effectiveLimit) projected = candidate;
  }
  return projected;
};
