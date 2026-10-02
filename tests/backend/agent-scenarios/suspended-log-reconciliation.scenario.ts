import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalSuspendedSessionLogAdapter } from '../../../packages/backend/src/infrastructure/ssh-suspend/local-suspended-session-log.adapter';
import { SshSuspendService } from '../../../packages/backend/src/modules/ssh-suspend/ssh-suspend.service';

export const suspendedLogReconciliationScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-suspended-log-reconcile-'));
  const logs = new LocalSuspendedSessionLogAdapter(directory);
  const service = new SshSuspendService(logs, { render: async (source) => source } as never, {
    ownerSweepMs: 60_000,
  });
  try {
    await logs.append('stale-before-restart', 'orphaned-history');
    assert.ok((await logs.position('stale-before-restart')) > 0);

    await service.initialize();
    assert.equal(
      await logs.position('stale-before-restart'),
      0,
      'startup must remove suspended SSH logs that have no recoverable in-memory owner',
    );

    return [{ name: 'suspended_ssh_log_startup_reconciliation', value: 1, unit: 'files' }];
  } finally {
    await service.dispose().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
