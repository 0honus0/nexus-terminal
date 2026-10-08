import type {
  WorkspaceStatus,
  ToolchainPackRef,
  PluginRunnerTarget,
  WorkspaceBrowserTarget,
  WorkspaceRecipe,
  WorkspaceJobResult,
} from '@nexus-terminal/protocol/runner';

export interface CatalogPack {
  schemaVersion: 1;
  familyId: string;
  versionId: string;
  displayName: string;
  archiveDigestByArch?: Record<string, string>;
  downloadRefByArch: Record<string, string>;
  capabilities: string[];
  runnerApiRange: string;
  diskBytes: number;
  dependencies: Array<{ familyId: string; versionId: string }>;
  supportedArchitectures: string[];
  status: 'supported' | 'deprecated' | 'unavailable';
}

export interface RuntimeCatalog {
  schemaVersion: 1;
  revision: string;
  runtimeDigest: string;
  recipes: WorkspaceRecipe[];
  packs: CatalogPack[];
}

export interface WorkspaceRecord {
  workspaceId: string;
  generation: number;
  status: WorkspaceStatus;
  retained: boolean;
  toolchain: ToolchainPackRef[];
  runnerPlugins: PluginRunnerTarget[];
  browserTarget: WorkspaceBrowserTarget | null;
}

export interface CommandRecord {
  commandId: string;
  payloadHash: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';
  action: string;
  workspaceId: string | null;
  result: unknown | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface JobRecord {
  jobId: string;
  payloadHash: string;
  workspaceId: string;
  generation: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
  result: WorkspaceJobResult | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}
