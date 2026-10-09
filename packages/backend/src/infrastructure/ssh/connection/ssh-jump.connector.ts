import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import type { ResolvedJumpHost, ResolvedSshConnection } from '../../../platform/connection/ssh-connection';
import { connectSshClient, createConnectConfig, SshClientRoute } from './ssh-client.connector';

const forward = (
	client: Client,
	host: string,
	port: number,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<ClientChannel> =>
	new Promise((resolve, reject) => {
		let settled = false;

		const finish = (error?: Error, stream?: ClientChannel) => {
			if (settled) {
				stream?.destroy();
				return;
			}
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			client.off('close', close);
			client.off('error', fail);
			if (error) reject(error);
			else resolve(stream!);
		};

		const abort = () => finish(new DOMException('SSH forwarding aborted.', 'AbortError'));

		const close = () => finish(new Error('SSH_FORWARD_CONNECTION_CLOSED'));

		const fail = (error: Error) => finish(error);

		const timer = setTimeout(() => finish(new Error('SSH_FORWARD_TIMEOUT')), timeoutMs);
		signal?.addEventListener('abort', abort, { once: true });
		client.once('close', close);
		client.once('error', fail);
		if (signal?.aborted) {
			abort();
			return;
		}
		try {
			client.forwardOut('127.0.0.1', 0, host, port, (error, stream) => finish(error, stream));
		} catch (error) {
			finish(error instanceof Error ? error : new Error(String(error)));
		}
	});

const buildHopConfig = (
	hop: ResolvedJumpHost,
	previousStream: ClientChannel | undefined,
	timeoutMs: number,
): ConnectConfig => ({
	...createConnectConfig(
		{
			host: previousStream ? undefined : hop.host,
			port: previousStream ? undefined : hop.port,
			username: hop.username,
			password: hop.password,
			privateKey: hop.privateKey,
			passphrase: hop.passphrase,
		},
		timeoutMs,
	),
	...(previousStream ? { sock: previousStream } : {}),
});

export const connectViaJumpChain = async (
	connection: ResolvedSshConnection,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<SshClientRoute> => {
	if (signal?.aborted) throw new DOMException('SSH jump connection aborted before start.', 'AbortError');
	const jumpChain = connection.jumpChain;
	if (!jumpChain?.length) {
		throw new Error(`Connection ${connection.displayName} is configured for jump routing without jump hosts.`);
	}

	const route = new SshClientRoute(`SSH ${connection.displayName} (${connection.connectionId}, jump)`);
	const deadline = Date.now() + timeoutMs;

	const remaining = () => {
		const value = deadline - Date.now();
		if (value <= 0) throw new Error('SSH_JUMP_CONNECT_TIMEOUT');
		return value;
	};

	let previousStream: ClientChannel | undefined;

	try {
		for (let index = 0; index < jumpChain.length; index += 1) {
			const hop = jumpChain[index];
			const connected = await connectSshClient(new Client(), {
				config: buildHopConfig(hop, previousStream, remaining()),
				label: `SSH jump ${index + 1} ${hop.host}:${hop.port}`,
				signal,
			});
			route.addIntermediate(connected);
			route.assertOpen();

			const next =
				index === jumpChain.length - 1
					? { host: connection.host, port: connection.port }
					: { host: jumpChain[index + 1].host, port: jumpChain[index + 1].port };
			previousStream = await forward(connected.client, next.host, next.port, remaining(), signal);
			route.assertOpen();
			if (signal?.aborted) {
				previousStream.destroy();
				throw new DOMException('SSH jump connection aborted.', 'AbortError');
			}
		}

		if (!previousStream)
			throw new Error(`Jump chain for ${connection.displayName} produced no stream to the final target.`);

		const finalClient = await connectSshClient(new Client(), {
			config: { ...createConnectConfig(connection, remaining()), sock: previousStream },
			label: `SSH ${connection.displayName} (${connection.connectionId}, jump-final)`,
			signal,
		});
		route.setPrimary(finalClient);
		route.assertOpen();
		return route;
	} catch (error) {
		try {
			previousStream?.destroy();
		} catch {
			/* best effort */
		}
		await route.close();
		throw route.failure ?? error;
	}
};
