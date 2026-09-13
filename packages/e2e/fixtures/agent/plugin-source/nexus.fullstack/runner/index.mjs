let active = false;
let contextRef = null;

const encode = (value) => new TextEncoder().encode(JSON.stringify(value, null, 2));

const module = {
  async activate(context) {
    contextRef = context;
    active = true;
    await context.sdk.workspace.write(
      '/runner-activation.json',
      encode({
        state: 'active',
        source: 'runner',
        workspaceId: context.workspace.workspaceId,
        generation: context.workspace.generation,
        pluginId: context.plugin.pluginId,
        version: context.plugin.version,
        protocolVersion: context.protocolVersion,
      }),
    );
  },

  health() {
    return active && contextRef
      ? { available: true, reason: null }
      : { available: false, reason: 'FULLSTACK_RUNNER_NOT_ACTIVE' };
  },

  quiesce() {
    return undefined;
  },

  dispose() {
    active = false;
    contextRef = null;
  },
};

export default module;
