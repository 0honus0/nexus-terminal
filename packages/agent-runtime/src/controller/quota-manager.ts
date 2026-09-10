import type { ResourceLimits } from '../types';

export interface RunnerQuotas {
  maxMemoryBytes: number;
  maxCpus: number;
  maxPids: number;
  maxTmpfsBytes: number;
}

export class QuotaManager {
  constructor(private readonly hard: RunnerQuotas) {}
  validate(limits: ResourceLimits): void {
    const integerValues = [limits.memoryBytes, limits.pids, limits.tmpfsBytes];
    if (typeof limits.cpus !== 'number' || !Number.isFinite(limits.cpus) || limits.cpus <= 0) {
      throw new Error('ENVIRONMENT_LIMIT_INVALID');
    }
    const values = integerValues;
    if (values.some((value) => !Number.isSafeInteger(value) || value < 1)) throw new Error('ENVIRONMENT_LIMIT_INVALID');
    if (
      limits.memoryBytes > this.hard.maxMemoryBytes ||
      limits.cpus > this.hard.maxCpus ||
      limits.pids > this.hard.maxPids ||
      limits.tmpfsBytes > this.hard.maxTmpfsBytes
    ) {
      throw new Error('ENVIRONMENT_LIMIT_EXCEEDED');
    }
  }
}
