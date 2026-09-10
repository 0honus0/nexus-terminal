import type { JsonValue, Scope, ClockPort } from '../../agent.types';
import type { SharedFactView, SubagentRepositoryPort } from './subagent.repository.port';

const MAX_FACT_BYTES = 64 * 1024;
const MAX_RUN_FACT_BYTES = 1024 * 1024;
const MAX_KEY_BYTES = 128;
const FACT_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

const normalizeKey = (value: string): string => {
  const key = value.trim();
  if (!key || Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES || !FACT_KEY.test(key)) {
    throw new Error('FACT_KEY_INVALID');
  }
  return key;
};

const normalizeValue = (value: unknown): JsonValue => {
  let encoded: string;
  try {
    encoded = JSON.stringify(value ?? null);
  } catch {
    throw new Error('VALIDATION_FAILED');
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_FACT_BYTES) throw new Error('FACT_TOO_LARGE');
  return JSON.parse(encoded) as JsonValue;
};

export class SharedFactsService {
  constructor(
    private readonly repository: SubagentRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async get(scope: Scope, runId: string, key: string): Promise<SharedFactView | null> {
    return this.repository.getFact(scope, runId, normalizeKey(key));
  }

  async compareAndSet(
    scope: Scope,
    runId: string,
    runtimeId: string,
    key: string,
    value: unknown,
    expectedVersion: number | null,
  ): Promise<SharedFactView> {
    if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
      throw new Error('VALIDATION_FAILED');
    }
    return this.repository.compareAndSetFact(
      scope,
      runId,
      runtimeId,
      normalizeKey(key),
      normalizeValue(value),
      expectedVersion,
      MAX_RUN_FACT_BYTES,
      this.clock.nowUnixSeconds(),
    );
  }
}
