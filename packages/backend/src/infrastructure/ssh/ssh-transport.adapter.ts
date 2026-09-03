import type { ResolvedSshConnection, SshConnectOptions } from '../../platform/connection/ssh-connection';
import type {
  RemoteExecutionTransport,
  RemoteExecutionTransportFactory,
} from '../../platform/execution/remote-execution.port';

/** ssh2 implementation is migrated into this adapter after the skeleton gate. */
export class SshTransportAdapter implements RemoteExecutionTransportFactory {
  connect(_connection: ResolvedSshConnection, _options?: SshConnectOptions): Promise<RemoteExecutionTransport> {
    return Promise.reject(new Error('SSH transport adapter has not been migrated yet.'));
  }
}
