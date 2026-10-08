import { executionBudgetMigrations } from './agent-execution-budget';
import { coreMigrations } from './core';
import { agentRuntimeMigrations } from './agent-runtime';
import { agentCapabilitiesMigrations } from './agent-capabilities';
import { agentHostMigrations } from './agent-host';
import type { SqliteMigration } from './migration.types';

// Global IDs and historical ordering remain authoritative across definition modules.
export const definedMigrations: SqliteMigration[] = [
  ...coreMigrations,
  ...agentRuntimeMigrations,
  ...agentCapabilitiesMigrations,
  ...agentHostMigrations,
  ...executionBudgetMigrations,
];
