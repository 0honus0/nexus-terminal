import rawManifest from './app.manifest.json';
import type { AgentAppContributionFactory, AgentAppDefinition, ValidatedManifest } from '../../host/app.types';

export interface OperationsAppDependencies {
  hasEnabledProvider(userId: number): Promise<boolean>;
  quiesce?(deadlineUnixSeconds: number): Promise<void>;
}

export const createOperationsAppContribution = (
  dependencies: OperationsAppDependencies,
): AgentAppContributionFactory => ({
  rawManifest,
  create(manifest: ValidatedManifest): AgentAppDefinition {
    return {
      manifest,
      defaultEnabled: true,
      defaultGrants: manifest.capabilities.map((capability) => ({
        capability,
        schemaVersion: 1,
        scope: { targetSelection: 'all-except-denylist' },
      })),
      health: async (scope) =>
        (await dependencies.hasEnabledProvider(scope.userId))
          ? { status: 'healthy' }
          : { status: 'degraded', reason: 'provider_not_configured' },
      quiesce: dependencies.quiesce,
    };
  },
});
