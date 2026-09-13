let active = false;
let activation = null;

const module = {
  async activate(context) {
    activation = context;
    active = true;
    const current = await context.sdk.storage.get('backend.status');
    await context.sdk.storage.put(
      'backend.status',
      {
        state: 'active',
        source: 'backend',
        appId: context.scope.appId,
        version: context.plugin.version,
        protocolVersion: context.protocolVersion,
      },
      current?.version ?? null,
    );
  },

  health() {
    return active && activation
      ? { available: true, reason: null }
      : { available: false, reason: 'FULLSTACK_BACKEND_NOT_ACTIVE' };
  },

  quiesce() {
    return undefined;
  },

  dispose() {
    active = false;
    activation = null;
  },

  migrate({ storage }) {
    return storage;
  },
};

export default module;
