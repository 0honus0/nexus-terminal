export const PLUGIN_RUNNER_PROTOCOL_VERSION = 3 as const;

export interface PluginRunnerTarget {
  pluginId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: typeof PLUGIN_RUNNER_PROTOCOL_VERSION;
  packageHash: string;
  entry: string;
}

export interface PluginRunnerTargetSourcePort {
  resolveRunnerTargets(userId: number, pluginIds: readonly string[]): Promise<PluginRunnerTarget[]>;
}
