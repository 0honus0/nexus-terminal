import { sshCredentialResolver } from './ssh-credential-resolver';
import { sshConnectionFactory } from './ssh-connection-factory';
import type { UnsavedSshConnectionInput } from './ssh-connection.types';

const TEST_TIMEOUT_MS = 15_000;

export class SshConnectionTester {
  async testStored(connectionId: number): Promise<{ latency: number }> {
    const startedAt = Date.now();
    const resolved = await sshCredentialResolver.resolveStored(connectionId);
    const client = await sshConnectionFactory.connect(resolved, TEST_TIMEOUT_MS);
    try {
      return { latency: Date.now() - startedAt };
    } finally {
      client.end();
    }
  }

  async testUnsaved(input: UnsavedSshConnectionInput): Promise<{ latency: number }> {
    const startedAt = Date.now();
    const resolved = await sshCredentialResolver.resolveUnsaved(input);
    const client = await sshConnectionFactory.connect(resolved, TEST_TIMEOUT_MS);
    try {
      return { latency: Date.now() - startedAt };
    } finally {
      client.end();
    }
  }
}

export const sshConnectionTester = new SshConnectionTester();
