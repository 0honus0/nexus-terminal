import type { RemoteExecutionTransportFactory } from '../../../platform/execution/remote-execution.port';
import type { UnsavedSshConnectionInput } from '../connection.types';
import type { SshConnectionResolver } from './ssh-connection-resolver.service';

const TEST_TIMEOUT_MS = 15_000;
export class SshConnectionTestService {
  constructor(
    private readonly resolver: SshConnectionResolver,
    private readonly transports: RemoteExecutionTransportFactory,
  ) {}
  async testStored(connectionId: number) {
    return this.test(await this.resolver.resolveStored(connectionId));
  }
  async testUnsaved(input: UnsavedSshConnectionInput) {
    return this.test(await this.resolver.resolveUnsaved(input));
  }
  private async test(connection: Awaited<ReturnType<SshConnectionResolver['resolveStored']>>) {
    const startedAt = Date.now();
    const transport = await this.transports.connect(connection, { timeoutMs: TEST_TIMEOUT_MS });
    try {
      return { latency: Date.now() - startedAt };
    } finally {
      await transport.close();
    }
  }
}
