import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import type { ResolvedJumpHost, ResolvedSshConnection } from '../../../platform/connection/ssh-connection';
import { connectSshClient, createConnectConfig } from './ssh-client.connector';

const forward = (client: Client, host: string, port: number): Promise<ClientChannel> =>
  new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (error, stream) => error ? reject(error) : resolve(stream));
  });

const buildHopConfig = (
  hop: ResolvedJumpHost,
  previousStream: ClientChannel | undefined,
  timeoutMs: number,
): ConnectConfig => ({
  ...createConnectConfig({
    host: previousStream ? undefined : hop.host,
    port: previousStream ? undefined : hop.port,
    username: hop.username,
    password: hop.password,
    privateKey: hop.privateKey,
    passphrase: hop.passphrase,
  }, timeoutMs),
  ...(previousStream ? { sock: previousStream } : {}),
});

export const connectViaJumpChain = async (
  connection: ResolvedSshConnection,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Client> => {
  if (signal?.aborted) throw new DOMException('SSH jump connection aborted before start.', 'AbortError');
  const jumpChain = connection.jumpChain;
  if (!jumpChain?.length) {
    throw new Error(`Connection ${connection.displayName} is configured for jump routing without jump hosts.`);
  }

  const intermediateClients: Client[] = [];
  let previousStream: ClientChannel | undefined;
  const cleanupIntermediates = () => {
    for (const client of intermediateClients.splice(0)) {
      try { client.end(); } catch { /* best effort */ }
    }
  };

  try {
    for (let index = 0; index < jumpChain.length; index += 1) {
      const hop = jumpChain[index];
      const client = new Client();
      await connectSshClient(client, {
        config: buildHopConfig(hop, previousStream, timeoutMs),
        label: `SSH jump ${index + 1} ${hop.host}:${hop.port}`,
        signal,
      });
      intermediateClients.push(client);

      const next = index === jumpChain.length - 1
        ? { host: connection.host, port: connection.port }
        : { host: jumpChain[index + 1].host, port: jumpChain[index + 1].port };
      previousStream = await forward(client, next.host, next.port);
      if (signal?.aborted) {
        previousStream.destroy();
        throw new DOMException('SSH jump connection aborted.', 'AbortError');
      }
    }

    if (!previousStream) throw new Error(`Jump chain for ${connection.displayName} produced no stream to the final target.`);
    const finalClient = new Client();
    await connectSshClient(finalClient, {
      config: { ...createConnectConfig(connection, timeoutMs), sock: previousStream },
      label: `SSH ${connection.displayName} (${connection.connectionId}, jump-final)`,
      signal,
    });
    finalClient.once('close', cleanupIntermediates);
    return finalClient;
  } catch (error) {
    try { previousStream?.destroy(); } catch { /* best effort */ }
    cleanupIntermediates();
    throw error;
  }
};
