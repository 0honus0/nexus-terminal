export const PLUGIN_RUNNER_PROTOCOL_VERSION = 2 as const;

export interface RunnerPluginWorkspaceStat {
  type: 'file' | 'directory';
  sizeBytes: number;
  modifiedAtMs: number;
}

export interface RunnerPluginSdkV1 {
  workspace: {
    read(targetPluginId: string, path: string): Promise<Uint8Array>;
    write(targetPluginId: string, path: string, value: Uint8Array): Promise<void>;
    list(targetPluginId: string, path: string): Promise<string[]>;
    stat(targetPluginId: string, path: string): Promise<RunnerPluginWorkspaceStat>;
    mkdir(targetPluginId: string, path: string): Promise<void>;
    rename(targetPluginId: string, path: string, destinationPath: string): Promise<void>;
    remove(targetPluginId: string, path: string): Promise<void>;
  };
}

export interface RunnerPluginActivationContextV1 {
  schemaVersion: 1;
  protocolVersion: typeof PLUGIN_RUNNER_PROTOCOL_VERSION;
  environment: Readonly<{ environmentId: string; generation: number }>;
  plugin: Readonly<{ pluginId: string; version: string; sdkVersion: string }>;
  sdk: RunnerPluginSdkV1;
}

export interface RunnerPluginModuleV1 {
  activate?(context: RunnerPluginActivationContextV1): Promise<void> | void;
  health?(): Promise<unknown> | unknown;
  quiesce?(deadlineUnixSeconds: number): Promise<void> | void;
  dispose?(): Promise<void> | void;
}
