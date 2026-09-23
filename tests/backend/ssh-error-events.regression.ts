import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Client, ClientChannel } from 'ssh2';
import { SshExecutionTransportAdapter } from '../../packages/backend/src/infrastructure/ssh/execution/ssh-execution-transport.adapter';
import { SshShellSessionAdapter } from '../../packages/backend/src/infrastructure/ssh/execution/ssh-shell-session.adapter';

class FakeClient extends EventEmitter {
  end(): void {}
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

const timeout = () =>
  Object.assign(new Error('read ETIMEDOUT'), {
    code: 'ETIMEDOUT',
    syscall: 'read',
    level: 'client-socket',
  });

const client = new FakeClient();
const transport = new SshExecutionTransportAdapter(42, client as unknown as Client);

assert.doesNotThrow(
  () => client.emit('error', timeout()),
  'an unobserved SSH transport error must not escape through EventEmitter error semantics',
);

let transportError: Error | undefined;
const offTransportError = transport.onError((error) => {
  transportError = error;
});
const observedTransportError = timeout();
client.emit('error', observedTransportError);
assert.equal(transportError, observedTransportError, 'transport subscribers must still receive SSH client errors');
offTransportError();

const channel = new FakeChannel();
const shell = new SshShellSessionAdapter(channel as unknown as ClientChannel);

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

process.stdout.write('ssh error event regression: PASS\n');
