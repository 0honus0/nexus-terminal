import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { SshSuspendService } from '../../../packages/backend/src/modules/ssh-suspend/ssh-suspend.service';
import { WorkspaceProtocolSession } from '../../../packages/backend/src/interfaces/websocket/workspace-protocol.session';

export const suspendedSessionOwnershipScenario = async () => {
  const logs = new Map<string, Buffer>();
  const logStore = {
    append: async (identifier: string, data: string | Uint8Array) => {
      const current = logs.get(identifier) ?? Buffer.alloc(0);
      const next = Buffer.concat([current, typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)]);
      logs.set(identifier, next);
      return next.byteLength;
    },
    flush: async () => undefined,
    openRead: async (identifier: string) => Readable.from([logs.get(identifier) ?? Buffer.alloc(0)]),
    position: async (identifier: string) => (logs.get(identifier) ?? Buffer.alloc(0)).byteLength,
    readTail: async (identifier: string, maxBytes: number) => {
      const data = logs.get(identifier) ?? Buffer.alloc(0);
      const startOffset = Math.max(0, data.byteLength - maxBytes);
      return { data: data.subarray(startOffset), startOffset, endOffset: data.byteLength, totalBytes: data.byteLength };
    },
    readBefore: async (identifier: string, beforeOffset: number, maxBytes: number) => {
      const data = logs.get(identifier) ?? Buffer.alloc(0);
      const endOffset = Math.min(beforeOffset, data.byteLength);
      const startOffset = Math.max(0, endOffset - maxBytes);
      return { data: data.subarray(startOffset, endOffset), startOffset, endOffset, totalBytes: data.byteLength };
    },
    delete: async (identifier: string) => {
      logs.delete(identifier);
    },
  };
  let now = 1_800_000_000_000;
  let transportOpen = true;
  let shellOpen = true;
  let pauses = 0;
  let resumes = 0;
  const transport = {
    connectionId: 77,
    get isOpen() {
      return transportOpen;
    },
    execute: async () => ({ exitCode: 0, stdout: '', stderr: '', truncated: false }),
    startCommand: async () => {
      throw new Error('not-used');
    },
    openShell: async () => {
      throw new Error('not-used');
    },
    fileSystem: async () => {
      throw new Error('not-used');
    },
    onClose: () => () => undefined,
    onError: () => () => undefined,
    close: async () => {
      transportOpen = false;
    },
  };
  const shell = {
    get isOpen() {
      return shellOpen;
    },
    write: () => true,
    resize: () => undefined,
    pause: () => {
      pauses += 1;
    },
    resume: () => {
      resumes += 1;
    },
    onDrain: () => () => undefined,
    onData: () => () => undefined,
    onStderr: () => () => undefined,
    onClose: () => () => undefined,
    onError: () => () => undefined,
    close: () => {
      shellOpen = false;
    },
  };
  const suspended = new SshSuspendService(logStore as never, {
    now: () => now,
    ownerLeaseMs: 1_000,
    ownerSweepMs: 60_000,
    takeoverWaitMs: 250,
  });
  const revocations: Array<{ ownerId: string; generation: number; reason: string }> = [];
  let currentAttached: { ownerId: string; generation: number; workspaceId: string } | null = null;
  const releaseOnRevoke = suspended.onOwnershipRevoked((event) => {
    revocations.push({ ownerId: event.ownerId, generation: event.generation, reason: event.reason });
    if (
      currentAttached &&
      currentAttached.ownerId === event.ownerId &&
      currentAttached.generation === event.generation
    ) {
      assert.equal(
        suspended.returnAttached(1, event.suspendSessionId, {
          ...currentAttached,
          transport: transport as never,
          shell: shell as never,
        }),
        true,
        'revoked owner must hand the same transport back to the same suspended resource',
      );
      currentAttached = null;
    }
  });

  try {
    const suspendSessionId = await suspended.takeOver({
      userId: 1,
      originalSessionId: 'workspace-origin',
      connectionName: 'ownership-fixture',
      connectionId: 77,
      logIdentifier: 'ownership-log',
      transport: transport as never,
      shell: shell as never,
    });
    assert.ok(suspendSessionId);

    const expiredCommit = await suspended.prepareResume(1, suspendSessionId!, undefined, {
      ownerId: 'device-expired-commit',
    });
    assert.ok(expiredCommit);
    now = expiredCommit.ownership.leaseExpiresAt + 1;
    assert.equal(
      await suspended.commitResume(1, suspendSessionId!, {
        ownerId: 'device-expired-commit',
        generation: expiredCommit.ownership.generation,
        workspaceId: 'workspace-expired-commit',
      }),
      false,
      'an expired resuming lease must not commit before the periodic sweep notices it',
    );
    assert.equal(
      await suspended.rollbackResume(1, suspendSessionId!, {
        ownerId: 'device-expired-commit',
        generation: expiredCommit.ownership.generation,
      }),
      true,
    );

    now += 1;
    const revokedCommit = await suspended.prepareResume(1, suspendSessionId!, undefined, {
      ownerId: 'device-revoked-commit',
    });
    assert.ok(revokedCommit);
    const takeoverAfterRevoke = suspended.prepareResume(1, suspendSessionId!, undefined, {
      ownerId: 'device-after-revoke',
      takeover: true,
    });
    await Promise.resolve();
    assert.equal(
      await suspended.commitResume(1, suspendSessionId!, {
        ownerId: 'device-revoked-commit',
        generation: revokedCommit.ownership.generation,
        workspaceId: 'workspace-revoked-commit',
      }),
      false,
      'a resuming owner must not commit after an explicit takeover revoke has been requested',
    );
    assert.equal(
      await suspended.rollbackResume(1, suspendSessionId!, {
        ownerId: 'device-revoked-commit',
        generation: revokedCommit.ownership.generation,
      }),
      true,
    );
    const afterRevoke = await takeoverAfterRevoke;
    assert.ok(afterRevoke);
    assert.equal(
      await suspended.rollbackResume(1, suspendSessionId!, {
        ownerId: 'device-after-revoke',
        generation: afterRevoke.ownership.generation,
      }),
      true,
    );

    now += 1;
    const preparedA = await suspended.prepareResume(1, suspendSessionId!, undefined, { ownerId: 'device-a' });
    assert.ok(preparedA);
    assert.equal(preparedA.transport, transport, 'resume must reuse the original SSH transport');
    assert.equal(
      await suspended.commitResume(1, suspendSessionId!, {
        ownerId: 'device-a',
        generation: preparedA.ownership.generation,
        workspaceId: 'workspace-a',
      }),
      true,
    );
    currentAttached = {
      ownerId: 'device-a',
      generation: preparedA.ownership.generation,
      workspaceId: 'workspace-a',
    };

    const afterCommit = suspended.list(1).find((session) => session.suspendSessionId === suspendSessionId);
    assert.ok(
      afterCommit,
      'P-056 requires the same server-owned suspended resource to survive attach so another device can explicitly takeover the same PTY',
    );
    assert.equal(afterCommit.ownershipState, 'attached');
    assert.equal(afterCommit.attachedWorkspaceId, 'workspace-a');

    const initialLease = afterCommit.ownershipLeaseExpiresAt!;
    now += 400;
    const renewed = suspended.renewOwnership(
      1,
      suspendSessionId!,
      'device-a',
      preparedA.ownership.generation,
      'workspace-a',
    );
    assert.ok(renewed);
    assert.ok(renewed.leaseExpiresAt > initialLease, 'live owner heartbeat must extend the lease');

    await assert.rejects(
      () => suspended.prepareResume(1, suspendSessionId!, undefined, { ownerId: 'device-b' }),
      /SUSPENDED_SESSION_OWNED/,
      'a second device cannot become a concurrent PTY consumer without explicit takeover',
    );

    const preparedB = await suspended.prepareResume(1, suspendSessionId!, undefined, {
      ownerId: 'device-b',
      takeover: true,
    });
    assert.ok(preparedB);
    assert.equal(preparedB.transport, transport, 'takeover must not create a replacement SSH transport');
    assert.equal(preparedB.shell, shell, 'takeover must reuse the same PTY shell');
    assert.ok(
      preparedB.ownership.generation > preparedA.ownership.generation,
      'takeover must advance owner generation so the revoked client is stale',
    );
    assert.equal(
      suspended.renewOwnership(1, suspendSessionId!, 'device-a', preparedA.ownership.generation, 'workspace-a'),
      null,
      'the revoked owner generation must never renew after takeover',
    );
    assert.equal(
      await suspended.rollbackResume(1, suspendSessionId!, {
        ownerId: 'device-b',
        generation: preparedB.ownership.generation,
      }),
      true,
      'failed takeover preparation must rollback the same suspended resource',
    );
    const afterTakeoverRollback = suspended.list(1).find((session) => session.suspendSessionId === suspendSessionId);
    assert.equal(
      afterTakeoverRollback?.ownershipState,
      'available',
      'rollback must make the same resource recoverable again',
    );
    assert.equal(
      afterTakeoverRollback?.originalSessionId,
      'workspace-a',
      'returning attached ownership must rebase recovery identity to the Workspace that handed the live shell back',
    );

    const preparedC = await suspended.prepareResume(1, suspendSessionId!, undefined, { ownerId: 'device-c' });
    assert.ok(preparedC);
    assert.equal(
      await suspended.commitResume(1, suspendSessionId!, {
        ownerId: 'device-c',
        generation: preparedC.ownership.generation,
        workspaceId: 'workspace-c',
      }),
      true,
    );
    currentAttached = {
      ownerId: 'device-c',
      generation: preparedC.ownership.generation,
      workspaceId: 'workspace-c',
    };
    now = preparedC.ownership.leaseExpiresAt + 1;
    assert.equal(suspended.sweepExpiredOwnership(now), 1, 'expired owner lease must trigger one revoke');
    assert.equal(
      suspended.list(1).find((session) => session.suspendSessionId === suspendSessionId)?.ownershipState,
      'available',
      'lease-expiry revoke must return the same resource to available',
    );

    const expiredRenew = await suspended.prepareResume(1, suspendSessionId!, undefined, {
      ownerId: 'device-expired-renew',
    });
    assert.ok(expiredRenew);
    assert.equal(
      await suspended.commitResume(1, suspendSessionId!, {
        ownerId: 'device-expired-renew',
        generation: expiredRenew.ownership.generation,
        workspaceId: 'workspace-expired-renew',
      }),
      true,
    );
    currentAttached = {
      ownerId: 'device-expired-renew',
      generation: expiredRenew.ownership.generation,
      workspaceId: 'workspace-expired-renew',
    };
    now = expiredRenew.ownership.leaseExpiresAt + 1;
    assert.equal(
      suspended.renewOwnership(
        1,
        suspendSessionId!,
        'device-expired-renew',
        expiredRenew.ownership.generation,
        'workspace-expired-renew',
      ),
      null,
      'an expired attached lease must not be revived by heartbeat before the periodic sweep runs',
    );
    assert.equal(
      suspended.list(1).find((session) => session.suspendSessionId === suspendSessionId)?.ownershipState,
      'available',
      'expired heartbeat rejection must trigger immediate lease-expired revoke/return',
    );

    now += 1;
    const preparedD = await suspended.prepareResume(1, suspendSessionId!, undefined, { ownerId: 'device-d' });
    assert.ok(preparedD);
    assert.equal(
      await suspended.commitResume(1, suspendSessionId!, {
        ownerId: 'device-d',
        generation: preparedD.ownership.generation,
        workspaceId: 'workspace-d',
      }),
      true,
    );
    currentAttached = {
      ownerId: 'device-d',
      generation: preparedD.ownership.generation,
      workspaceId: 'workspace-d',
    };
    assert.equal(
      suspended.forgetAttached(1, suspendSessionId!, {
        ownerId: 'device-d',
        generation: preparedD.ownership.generation,
        workspaceId: 'workspace-d',
      }),
      true,
      'unmark must release the resumable catalog owner without closing the live Workspace transport',
    );
    currentAttached = null;
    assert.equal(
      suspended.list(1).some((session) => session.suspendSessionId === suspendSessionId),
      false,
    );
    assert.equal(transportOpen, true, 'unmark/forget must not close the live SSH transport');
    assert.equal(shellOpen, true, 'unmark/forget must not close the live PTY shell');

    assert.deepEqual(
      revocations.map((event) => [event.ownerId, event.reason]),
      [
        ['device-expired-commit', 'lease_expired'],
        ['device-revoked-commit', 'takeover'],
        ['device-a', 'takeover'],
        ['device-c', 'lease_expired'],
        ['device-expired-renew', 'lease_expired'],
      ],
      'only explicit takeover and lease expiry may revoke active owners in this scenario',
    );

    const protocolSent: string[] = [];
    const protocolCloses: Array<{ code?: number; reason?: string }> = [];
    const protocolSocket = {
      readyState: 1,
      bufferedAmount: 0,
      send: (value: unknown) => {
        protocolSent.push(typeof value === 'string' ? value : Buffer.from(value as Uint8Array).toString('utf8'));
      },
      close(code?: number, reason?: string) {
        protocolCloses.push({ code, reason });
        this.readyState = 3;
      },
    };
    const protocol = new WorkspaceProtocolSession(
      protocolSocket as never,
      { userId: 1, username: 'ownership-fixture', clientIp: '127.0.0.1' },
      {
        suspended,
        suspendCoordinator: {
          renewOwnership: () => {
            throw new Error('not-bound');
          },
        },
        terminal: {},
      } as never,
    );
    const protocolOwnerId = (protocol as unknown as { consumerId: string }).consumerId;
    const protocolSuspendSessionId = await suspended.takeOver({
      userId: 1,
      originalSessionId: 'workspace-protocol-origin',
      connectionName: 'protocol-ownership-fixture',
      connectionId: 77,
      logIdentifier: 'protocol-ownership-log',
      transport: transport as never,
      shell: shell as never,
    });
    assert.ok(protocolSuspendSessionId);
    const preparedProtocol = await suspended.prepareResume(1, protocolSuspendSessionId!, undefined, {
      ownerId: protocolOwnerId,
    });
    assert.ok(preparedProtocol);
    assert.equal(
      await suspended.commitResume(1, protocolSuspendSessionId!, {
        ownerId: protocolOwnerId,
        generation: preparedProtocol.ownership.generation,
        workspaceId: 'workspace-protocol-owner',
      }),
      true,
    );
    now = preparedProtocol.ownership.leaseExpiresAt + 1;
    assert.equal(suspended.sweepExpiredOwnership(now), 1);
    const revokeWire = protocolSent
      .map((entry) => {
        try {
          return JSON.parse(entry) as { type?: string; payload?: { reason?: string } };
        } catch {
          return {};
        }
      })
      .find((entry) => entry.type === 'suspend.revoked');
    assert.equal(
      revokeWire?.payload?.reason,
      'lease_expired',
      'revoked owner must receive an explicit protocol reason',
    );
    assert.deepEqual(
      protocolCloses.at(-1),
      { code: 4009, reason: 'Suspended session owner lease expired.' },
      'revoked owner socket must be closed with the dedicated ownership code and reason',
    );
    const wireCountAfterRevoke = protocolSent.length;
    await protocol.handleMessage(
      Buffer.from(
        JSON.stringify({
          type: 'terminal.input',
          payload: { data: 'must-not-reach-pty' },
        }),
        'utf8',
      ),
      false,
    );
    assert.equal(
      protocolSent.length,
      wireCountAfterRevoke,
      'revoked protocol must ignore later requests instead of allowing the old consumer to reclaim/write the PTY',
    );
    await protocol.close();

    return [
      { name: 'suspended_session_retained_after_attach', value: 1, unit: 'sessions' },
      { name: 'suspended_session_concurrent_owner_rejections', value: 1, unit: 'cases' },
      { name: 'suspended_session_takeover_revocations', value: 1, unit: 'events' },
      { name: 'suspended_session_lease_expiry_revocations', value: 1, unit: 'events' },
      { name: 'suspended_session_rollback_recoveries', value: 1, unit: 'cases' },
      {
        name: 'suspended_session_owner_generation_advances',
        value: preparedD.ownership.generation - preparedA.ownership.generation,
        unit: 'generations',
      },
      { name: 'suspended_session_expired_commit_rejections', value: 1, unit: 'cases' },
      { name: 'suspended_session_revoked_commit_rejections', value: 1, unit: 'cases' },
      { name: 'suspended_session_expired_renew_rejections', value: 1, unit: 'cases' },
      { name: 'suspended_session_transport_replacements', value: 0, unit: 'transports' },
      { name: 'suspended_session_unmark_transport_closes', value: transportOpen ? 0 : 1, unit: 'transports' },
      { name: 'suspended_session_revoke_protocol_events', value: revokeWire ? 1 : 0, unit: 'events' },
      { name: 'suspended_session_revoked_protocol_writes', value: 0, unit: 'writes' },
      { name: 'suspended_session_pause_calls', value: pauses, unit: 'calls' },
      { name: 'suspended_session_resume_calls', value: resumes, unit: 'calls' },
    ];
  } finally {
    releaseOnRevoke();
    if (transportOpen) await transport.close();
    await suspended.dispose();
  }
};
