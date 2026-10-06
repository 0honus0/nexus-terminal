'use strict';

// CommonJS runtime surface for deployed Agent Runner consumers.
// Keep these values aligned with src/runner.ts, which remains the typed workspace source.
exports.WORKSPACE_JOB_LIMITS = Object.freeze({
  minExecutionTimeoutMs: 1000,
  defaultExecutionTimeoutMs: 300000,
  maxExecutionTimeoutMs: 86400000,
  defaultConcurrentJobs: 8,
  maxConcurrentJobs: 64,
});
