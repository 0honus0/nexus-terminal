import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

let active = false;
let activation = null;

const assertDenied = (probe, expectedPermission) => {
  try {
    probe();
  } catch (error) {
    if (error?.code === 'ERR_ACCESS_DENIED' && error?.permission === expectedPermission) return true;
    throw error;
  }
  throw new Error(`FULLSTACK_PERMISSION_NOT_ENFORCED:${expectedPermission}`);
};

const module = {
  async activate(context) {
    activation = context;
    active = true;
    const fileReadDenied = assertDenied(() => fs.readFileSync('/etc/passwd', 'utf8'), 'FileSystemRead');
    const childProcessDenied = assertDenied(() => spawnSync(process.execPath, ['--version']), 'ChildProcess');
    const current = await context.sdk.storage.get('backend.status');
    await context.sdk.storage.put(
      'backend.status',
      {
        state: 'active',
        source: 'backend',
        appId: context.scope.appId,
        version: context.plugin.version,
        protocolVersion: context.protocolVersion,
        fileReadDenied,
        childProcessDenied,
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
