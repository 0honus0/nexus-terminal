import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Client, ClientChannel } from 'ssh2';
import {
  connectSshClient,
  ConnectedSshClient,
  SshClientRoute,
} from '../../packages/backend/src/infrastructure/ssh/connection/ssh-client.connector';
import { SshExecutionTransportAdapter } from '../../packages/backend/src/infrastructure/ssh/execution/ssh-execution-transport.adapter';
import { SshCommandSessionAdapter } from '../../packages/backend/src/infrastructure/ssh/execution/ssh-command-session.adapter';
import { SshShellSessionAdapter } from '../../packages/backend/src/infrastructure/ssh/execution/ssh-shell-session.adapter';

class FakeClient extends EventEmitter {
  ended = false;

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.emit('close');
  }
}

class FakeConnectClient extends FakeClient {
  connect(): void {
    this.emit('ready');
  }

  setNoDelay(): void {}
}

class FakeChannel extends EventEmitter {
  readonly stderr = new EventEmitter();
  destroyed = false;

  write(): boolean {
    return true;
  }

  setWindow(): void {}

  signal(): void {}

  pause(): void {}

  resume(): void {}

  close(): void {
    this.destroyed = true;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

const timeout = (message = 'read ETIMEDOUT') =>
  Object.assign(new Error(message), {
    code: 'ETIMEDOUT',
    syscall: 'read',
    level: 'client-socket',
  });

const createTransport = (connectionId: number, label: string) => {
  const raw = new FakeClient();
  const route = new SshClientRoute(label);
  route.setPrimary(new ConnectedSshClient(raw as unknown as Client, `${label} final`));
  return { raw, route, transport: new SshExecutionTransportAdapter(connectionId, route) };
};

{
  const { raw, transport } = createTransport(42, 'direct');
  assert.doesNotThrow(
    () => raw.emit('error', timeout()),
    'an unobserved SSH transport error must not escape through EventEmitter error semantics',
  );
  assert.equal(transport.isOpen, false, 'a raw SSH client error must close its transport route');
}

{
  const { raw, transport } = createTransport(43, 'observed');
  let transportError: Error | undefined;
  const offTransportError = transport.onError((error) => {
    transportError = error;
  });
  const observedTransportError = timeout();
  raw.emit('error', observedTransportError);
  assert.equal(transportError, observedTransportError, 'transport subscribers must still receive SSH client errors');
  assert.equal(transport.isOpen, false, 'observed SSH errors must still close the route');
  offTransportError();
}

{
  const { raw, transport } = createTransport(46, 'throwing-consumer');
  transport.onError(() => {
    throw new Error('consumer transport error');
  });
  assert.doesNotThrow(
    () => raw.emit('error', timeout('transport listener throws')),
    'a throwing transport subscriber must not escape back into the ssh2 client event stack',
  );
}

{
  const { raw, transport } = createTransport(45, 'intentional-close');
  let lateErrorCount = 0;
  transport.onError(() => {
    lateErrorCount += 1;
  });

  raw.end();
  assert.equal(transport.isOpen, false, 'an intentional/raw close must close the logical transport');
  assert.doesNotThrow(
    () => raw.emit('error', timeout('late error after close')),
    'late ssh2 errors after route close must remain contained by the raw-client lifecycle guard',
  );
  assert.equal(lateErrorCount, 0, 'late errors after a completed close must not be surfaced as new transport faults');
}

{
  const intermediateRaw = new FakeClient();
  const finalRaw = new FakeClient();
  const route = new SshClientRoute('jump route');
  route.addIntermediate(new ConnectedSshClient(intermediateRaw as unknown as Client, 'jump hop 1'));
  route.setPrimary(new ConnectedSshClient(finalRaw as unknown as Client, 'jump final'));
  const transport = new SshExecutionTransportAdapter(44, route);

  let observed: Error | undefined;
  transport.onError((error) => {
    observed = error;
  });

  const keepaliveTimeout = timeout('Keepalive timeout');
  assert.doesNotThrow(
    () => intermediateRaw.emit('error', keepaliveTimeout),
    'a jump-hop keepalive timeout must be owned by the route instead of becoming an uncaught exception',
  );
  assert.equal(observed, keepaliveTimeout, 'jump-hop errors must propagate through the transport error surface');
  assert.equal(transport.isOpen, false, 'jump-hop errors must close the logical SSH transport');
  assert.equal(intermediateRaw.ended, true, 'the failed jump client must be ended');
  assert.equal(finalRaw.ended, true, 'a failed jump hop must cascade close to the final SSH client');
}

{
  const handoffRaw = new FakeClient();
  const guarded = new ConnectedSshClient(handoffRaw as unknown as Client, 'handoff client');
  const handoffError = timeout('Keepalive timeout during handoff');

  assert.doesNotThrow(
    () => handoffRaw.emit('error', handoffError),
    'a connected raw client must keep an error guard before route/transport ownership is attached',
  );

  const route = new SshClientRoute('handoff route');
  route.setPrimary(guarded);
  assert.equal(route.isOpen, false, 'a pre-handoff client error must invalidate the route');
  assert.equal(route.failure, handoffError, 'the pre-handoff error must remain available to the route owner');
}

const commandChannel = new FakeChannel();
const command = new SshCommandSessionAdapter(
  'command-session',
  'echo test',
  commandChannel as unknown as ClientChannel,
  1024,
);
command.onStdout(() => {
  throw new Error('consumer stdout error');
});
assert.doesNotThrow(
  () => commandChannel.emit('data', Buffer.from('hello')),
  'a throwing command stdout subscriber must be isolated from the ssh2 channel callback',
);
command.onError(() => {
  throw new Error('consumer command error');
});
assert.doesNotThrow(
  () => commandChannel.emit('error', timeout('command listener throws')),
  'a throwing command error subscriber must be isolated from the ssh2 channel callback',
);
command.onClose(() => {
  throw new Error('consumer command close error');
});
assert.doesNotThrow(
  () => commandChannel.emit('close', 0, null),
  'a throwing command close subscriber must be isolated from the ssh2 channel callback',
);

const channel = new FakeChannel();
const shell = new SshShellSessionAdapter(channel as unknown as ClientChannel);

shell.onData(() => {
  throw new Error('consumer shell data error');
});
assert.doesNotThrow(
  () => channel.emit('data', Buffer.from('shell-data')),
  'a throwing shell data subscriber must be isolated from the ssh2 channel callback',
);
shell.onDrain(() => {
  throw new Error('consumer shell drain error');
});
assert.doesNotThrow(
  () => channel.emit('drain'),
  'a throwing shell drain subscriber must be isolated from the raw ssh2 channel event',
);

assert.doesNotThrow(
  () => channel.emit('error', timeout()),
  'an unobserved SSH shell error must not escape through EventEmitter error semantics',
);

let shellError: Error | undefined;
const offShellError = shell.onError((error) => {
  shellError = error;
});
const observedShellError = timeout();
channel.emit('error', observedShellError);
assert.equal(shellError, observedShellError, 'shell subscribers must still receive SSH channel errors');
offShellError();

const offThrowingShellError = shell.onError(() => {
  throw new Error('consumer shell error');
});
assert.doesNotThrow(
  () => channel.emit('error', timeout('shell listener throws')),
  'a throwing shell error subscriber must not escape back into the ssh2 channel event stack',
);
offThrowingShellError();

shell.onClose(() => {
  throw new Error('consumer shell close error');
});
assert.doesNotThrow(
  () => channel.emit('close'),
  'a throwing shell close subscriber must be isolated from the ssh2 channel callback',
);

const ownedCloseChannel = new FakeChannel();
const ownedCloseShell = new SshShellSessionAdapter(ownedCloseChannel as unknown as ClientChannel);
let ownedCloseEvents = 0;
ownedCloseShell.onClose(() => {
  ownedCloseEvents += 1;
});
ownedCloseShell.close();
assert.equal(ownedCloseEvents, 1, 'transport-owned shell close must notify terminal owners immediately');
ownedCloseChannel.emit('close');
assert.equal(ownedCloseEvents, 1, 'late ssh2 close must not duplicate the owned shell close notification');

const connectedRaw = new FakeConnectClient();
connectSshClient(connectedRaw as unknown as Client, {
  config: { username: 'test' },
  label: 'ready-handoff',
})
  .then(async (connected) => {
    const postReadyError = timeout('Keepalive timeout after ready');
    assert.doesNotThrow(
      () => connectedRaw.emit('error', postReadyError),
      'connectSshClient must retain a permanent error owner after its temporary ready listener is removed',
    );
    assert.equal(
      connected.lastError,
      postReadyError,
      'post-ready ssh2 errors must remain attached to the connected owner',
    );

    const lateRaw = new FakeClient();
    const lateRoute = new SshClientRoute('late-subscriber');
    lateRoute.setPrimary(new ConnectedSshClient(lateRaw as unknown as Client, 'late final'));
    const lateTransport = new SshExecutionTransportAdapter(47, lateRoute);
    const lateFailure = timeout('Keepalive timeout before transport subscriber');
    lateRaw.emit('error', lateFailure);

    let replayedError: Error | undefined;
    let replayedClose = false;
    lateTransport.onError((error) => {
      replayedError = error;
    });
    lateTransport.onClose(() => {
      replayedClose = true;
    });
    await Promise.resolve();
    assert.equal(
      replayedError,
      lateFailure,
      'late transport error subscribers must receive the terminal route failure',
    );
    assert.equal(replayedClose, true, 'late transport close subscribers must observe an already-closed route');

    process.stdout.write('ssh error event regression: PASS\n');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
