import type { IntegrationConfiguration, IntegrationKind, IntegrationView } from './integrations.types';
import type { Scope } from '../agent.types';

export interface IntegrationCreateRecord {
  id: string;
  scope: Scope;
  kind: IntegrationKind;
  configuration: IntegrationConfiguration;
  enabled: boolean;
  credential?: string;
  createdAt: number;
}

export interface IntegrationUpdateRecord {
  configuration: IntegrationConfiguration;
  enabled: boolean;
  credential?: string;
  clearCredential: boolean;
  updatedAt: number;
}

export interface IntegrationRepositoryPort {
  get(scope: Scope, integrationId: string): Promise<IntegrationView | null>;
  list(scope: Scope, kind?: IntegrationKind): Promise<IntegrationView[]>;
  create(record: IntegrationCreateRecord): Promise<IntegrationView>;
  update(
    scope: Scope,
    integrationId: string,
    expectedVersion: number,
    record: IntegrationUpdateRecord,
  ): Promise<IntegrationView>;
  updateSchemaHash(scope: Scope, integrationId: string, schemaHash: string | null, updatedAt: number): Promise<void>;
  remove(scope: Scope, integrationId: string, expectedVersion: number): Promise<void>;
}

export interface IntegrationSecretPort {
  withCredential<T>(
    scope: Scope,
    integrationId: string,
    credentialRevision: number,
    work: (credential: string | null) => Promise<T>,
  ): Promise<T>;
}
