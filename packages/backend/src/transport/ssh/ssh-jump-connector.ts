import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import type { ResolvedJumpHost, ResolvedSshConnection } from './ssh-connection.types';
import { connectSshClient, createConnectConfig } from './ssh-client-connector';

const forward = (
  client: Client,
  host: string,
  port: number,
): Promise<ClientChannel> => new Promise((resolve, reject) => {
  client.forwardOut('127.0.0.1', 0, host, port, (error, stream) => {
    if (error) reject(error);
    else resolve(stream);
  });
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
  if (!jumpChain?.length) throw new Error(`Connection ${connection.name} is configured for jump routing without jump hosts.`);

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
        connectionId: null,
        connectionName: hop.name || hop.host,
        finalClient: false,
        signal,
      });
      intermediateClients.push(client);

      const next = index === jumpChain.length - 1
        ? { host: connection.host, port: connection.port }
        : { host: jumpChain[index + 1].host, port: jumpChain[index + 1].port };
      previousStream = await forward(client, next.host, next.port);
      if (signal?.aborted) throw new DOMException('SSH jump connection aborted.', 'AbortError');
    }

    if (!previousStream) throw new Error(`Jump chain for ${connection.name} produced no stream to the final target.`);

    const finalClient = new Client();
    const finalConfig: ConnectConfig = {
      ...createConnectConfig(connection, timeoutMs),
      sock: previousStream,
    };
    await connectSshClient(finalClient, {
      config: finalConfig,
      connectionId: connection.id,
      connectionName: connection.name,
      finalClient: true,
      signal,
    });

    // Intermediate jump clients are transport dependencies of the final client.
    // Keep them alive for the tunnel lifetime and release them with the final transport.
    finalClient.once('close', cleanupIntermediates);
    return finalClient;
  } catch (error) {
    try { previousStream?.destroy(); } catch { /* best effort */ }
    cleanupIntermediates();
    throw error;
  }
};
