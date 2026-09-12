export const PLUGIN_RUNNER_PROTOCOL_VERSION = 3 as const;

export interface RunnerPluginWorkspaceStat {
  type: 'file' | 'directory';
  sizeBytes: number;
  modifiedAtMs: number;
}

export interface RunnerPluginSdkV1 {
  workspace: {
    read(path: string): Promise<Uint8Array>;
    write(path: string, value: Uint8Array): Promise<void>;
    list(path: string): Promise<string[]>;
    stat(path: string): Promise<RunnerPluginWorkspaceStat>;
    mkdir(path: string): Promise<void>;
    rename(path: string, destinationPath: string): Promise<void>;
    remove(path: string): Promise<void>;
  };
}

export interface RunnerPluginActivationContextV1 {
  schemaVersion: 1;
  protocolVersion: typeof PLUGIN_RUNNER_PROTOCOL_VERSION;
  workspace: Readonly<{ workspaceId: string; generation: number }>;
  plugin: Readonly<{ pluginId: string; version: string; sdkVersion: string }>;
  sdk: RunnerPluginSdkV1;
}

export interface RunnerPluginModuleV1 {
  activate?(context: RunnerPluginActivationContextV1): Promise<void> | void;
  health?(): Promise<unknown> | unknown;
  quiesce?(deadlineUnixSeconds: number): Promise<void> | void;
  dispose?(): Promise<void> | void;
}
