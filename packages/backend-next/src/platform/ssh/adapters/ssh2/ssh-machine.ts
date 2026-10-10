import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2';
import type { EventEmitter } from 'node:events';
import type {
	MachineConnection,
	MachineConnectOptions,
	MachineEndpoint,
	MachineSshFactory,
	MachinePty,
	MachineShell,
	MachineCommand,
	MachineCommandResult,
	MachineSftpLease,
	MachineExecuteOptions,
} from '../../ssh-port.js';
import { openSshRoute, type ConnectedRoute } from './ssh-route.js';
import { SshShellChannel, SshCommandChannel } from './ssh-channels.js';
import { SshSftpLease } from './ssh-sftp.js';

interface CommandChannelOptions {
	signal?: AbortSignal;
	cancelWhenAborted?: boolean;
}

const CHANNEL_OPEN_TIMEOUT_MS = 30000;
const CLIENT_CLOSE_TIMEOUT_MS = 2000;

function closeClient(client: Client): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			client.destroy();
			resolve();
		}, CLIENT_CLOSE_TIMEOUT_MS);
		client.once('close', () => {
			clearTimeout(timer);
			resolve();
		});
		client.end();
	});
}

function timeoutError(): Error {
	return new Error('SSH channel request timed out');
}

class ConnectedMachine implements MachineConnection {
	private readonly closeListeners = new Set<(reason: 'disconnected') => void>();
	private readonly channels = new Set<MachineShell | SshCommandChannel>();
	private readonly leases = new Set<SshSftpLease>();
	private readonly stop = new AbortController();
	private closePromise: Promise<void> | null = null;
	private disconnected = false;

	constructor(private readonly route: ConnectedRoute) {
		route.assertOpen();

		const monitor = (resource: EventEmitter) => {
			resource.on('error', () => this.disconnectedByRemote());
			resource.on('close', () => this.disconnectedByRemote());
		};

		route.clients.forEach(monitor);
		route.sockets.forEach(monitor);
		// Install the live owner before removing construction-time monitoring.
		route.releaseMonitors();
	}

	get isOpen(): boolean {
		return !this.disconnected && this.closePromise === null;
	}

	private disconnectedByRemote(): void {
		if (this.disconnected) {
			return;
		}
		this.disconnected = true;
		this.stop.abort(new Error('SSH transport disconnected'));
		for (const listener of [...this.closeListeners]) {
			try {
				listener('disconnected');
			} catch {
				/* callbacks do not change resource owner */
			}
		}
		this.closeListeners.clear();
		void this.close().catch(() => undefined);
	}

	onClose(listener: (reason: 'disconnected') => void): () => void {
		if (!this.isOpen) {
			queueMicrotask(() => listener('disconnected'));
			return () => undefined;
		}
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	private requireClient(): Client {
		if (!this.isOpen) {
			throw new Error('SSH machine connection closed');
		}
		return this.route.primary;
	}

	private async openChannel(
		create: (client: Client, callback: (error: Error | undefined, channel: ClientChannel) => void) => void,
		signal?: AbortSignal,
	): Promise<ClientChannel> {
		const client = this.requireClient();
		return new Promise((resolve, reject) => {
			let settled = false;

			const cleanup = () => {
				clearTimeout(timeout);
				client.off('close', disconnected);
				client.off('error', failed);
				signal?.removeEventListener('abort', aborted);
				this.stop.signal.removeEventListener('abort', aborted);
			};

			const finish = (error?: Error, channel?: ClientChannel) => {
				if (settled) {
					channel?.destroy();
					return;
				}
				settled = true;
				cleanup();
				if (error) {
					channel?.destroy();
					reject(error);
				} else if (!this.isOpen || signal?.aborted) {
					channel?.destroy();
					reject(new Error('SSH channel no longer owned'));
				} else {
					resolve(channel!);
				}
			};

			const disconnected = () => finish(new Error('SSH transport disconnected'));

			const failed = (error: Error) => finish(error);

			const aborted = () => finish(new DOMException('SSH channel aborted', 'AbortError'));

			const timeout = setTimeout(() => finish(timeoutError()), CHANNEL_OPEN_TIMEOUT_MS);
			client.once('close', disconnected);
			client.once('error', failed);
			signal?.addEventListener('abort', aborted, { once: true });
			this.stop.signal.addEventListener('abort', aborted, { once: true });
			if (signal?.aborted || this.stop.signal.aborted) {
				return aborted();
			}
			try {
				create(client, (error, channel) => finish(error, channel));
			} catch (error) {
				finish(error instanceof Error ? error : new Error('SSH channel rejected', { cause: error }));
			}
		});
	}

	async openShell(pty: MachinePty, signal?: AbortSignal): Promise<MachineShell> {
		if (!Number.isInteger(pty.columns) || !Number.isInteger(pty.rows) || pty.columns < 1 || pty.rows < 1) {
			throw new Error('Invalid terminal dimensions');
		}
		const channel = await this.openChannel(
			(client, callback) =>
				client.shell({ term: pty.term ?? 'xterm-256color', cols: pty.columns, rows: pty.rows }, callback),
			signal,
		);
		const shell = new SshShellChannel(channel, () => this.channels.delete(shell));
		this.channels.add(shell);
		return shell;
	}

	private async createCommandChannel(
		command: string,
		{ signal, cancelWhenAborted = true }: CommandChannelOptions,
	): Promise<SshCommandChannel> {
		if (!command) {
			throw new Error('Empty SSH command');
		}
		const channel = await this.openChannel(
			(client, callback) => client.exec(command, { pty: false }, callback),
			signal,
		);
		const result = new SshCommandChannel(channel, () => this.channels.delete(result));
		this.channels.add(result);
		if (signal && cancelWhenAborted) {
			const abort = () => result.cancel();

			const offClose = result.onClose(() => {
				signal.removeEventListener('abort', abort);
				offClose();
			});
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) {
				abort();
			}
		}
		return result;
	}

	openRawCommand(command: string, signal?: AbortSignal): Promise<MachineCommand> {
		return this.createCommandChannel(command, { signal });
	}

	async execute(command: string, options: MachineExecuteOptions): Promise<MachineCommandResult> {
		if (
			!Number.isSafeInteger(options.maxOutputBytes) ||
			options.maxOutputBytes < 1 ||
			options.maxOutputBytes > 16 * 1024 * 1024
		) {
			throw new Error('Invalid command output budget');
		}
		if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 300000) {
			throw new Error('Invalid command timeout');
		}
		options.signal?.throwIfAborted();
		const controller = new AbortController();

		const abort = () => controller.abort(options.signal?.reason);

		options.signal?.addEventListener('abort', abort, { once: true });
		const timeout = setTimeout(() => controller.abort(new Error('SSH command timeout')), options.timeoutMs);
		let commandChannel: SshCommandChannel | null = null;
		try {
			commandChannel = await this.createCommandChannel(command, {
				signal: controller.signal,
				cancelWhenAborted: false,
			});
			return await this.collectCommandResult(commandChannel, options, controller.signal);
		} finally {
			clearTimeout(timeout);
			options.signal?.removeEventListener('abort', abort);
			commandChannel?.close();
		}
	}

	private async collectCommandResult(
		channel: SshCommandChannel,
		options: MachineExecuteOptions,
		signal: AbortSignal,
	): Promise<MachineCommandResult> {
		const outputs: Buffer[][] = [[], []];
		let size = 0;
		let truncated = false;

		const collect = (index: number, data: Buffer | string) => {
			const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
			const available = options.maxOutputBytes - size;
			if (bytes.length > available) {
				truncated = true;
			}
			if (available > 0) {
				const item = bytes.subarray(0, Math.min(bytes.length, available));
				outputs[index].push(item);
				size += item.length;
			}
		};

		const onData = (data: Buffer | string) => collect(0, data);

		channel.readable.on('data', onData);
		const unsubscribe = channel.onStderr((bytes) => collect(1, Buffer.from(bytes)));

		const abortCommand = () => channel.cancel(options.signal?.aborted ? 'cancelled' : 'timeout');

		signal.addEventListener('abort', abortCommand, { once: true });
		if (signal.aborted) {
			abortCommand();
		}
		try {
			const outcome = await channel.outcome;
			return {
				outcome,
				stdout: Buffer.concat(outputs[0]).toString('utf8'),
				stderr: Buffer.concat(outputs[1]).toString('utf8'),
				truncated,
			};
		} finally {
			signal.removeEventListener('abort', abortCommand);
			unsubscribe();
			channel.readable.off('data', onData);
		}
	}

	async openSftp(signal?: AbortSignal): Promise<MachineSftpLease> {
		const sftp = await this.openSftpChannel(signal);
		const lease = new SshSftpLease(sftp, () => queueMicrotask(() => this.leases.delete(lease)), signal);
		this.leases.add(lease);
		if (signal?.aborted || !this.isOpen) {
			await lease.close();
			throw new DOMException('SFTP lease no longer owned', 'AbortError');
		}
		return lease;
	}

	private openSftpChannel(signal?: AbortSignal): Promise<SFTPWrapper> {
		const client = this.requireClient();
		return new Promise<SFTPWrapper>((resolve, reject) => {
			let settled = false;

			const cleanup = () => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', aborted);
				this.stop.signal.removeEventListener('abort', aborted);
				client.off('close', lost);
				client.off('error', failed);
			};

			const finish = (error?: Error, channel?: SFTPWrapper) => {
				if (settled) {
					channel?.end();
					return;
				}
				settled = true;
				cleanup();
				if (error || !this.isOpen || signal?.aborted) {
					channel?.end();
					reject(error ?? new Error('SSH connection closed before SFTP ready'));
				} else {
					resolve(channel!);
				}
			};

			const aborted = () => finish(new DOMException('SFTP opening cancelled', 'AbortError'));

			const lost = () => finish(new Error('SSH connection closed'));

			const failed = (error: Error) => finish(error);

			const timer = setTimeout(() => finish(new Error('SFTP opening timed out')), CHANNEL_OPEN_TIMEOUT_MS);
			signal?.addEventListener('abort', aborted, { once: true });
			this.stop.signal.addEventListener('abort', aborted, { once: true });
			client.once('close', lost);
			client.once('error', failed);
			if (signal?.aborted || this.stop.signal.aborted) {
				return aborted();
			}
			try {
				client.sftp((error, channel) => finish(error, channel));
			} catch (error) {
				finish(error instanceof Error ? error : new Error('SFTP request rejected', { cause: error }));
			}
		});
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closePromise = Promise.resolve().then(() => this.closeResources());
		return this.closePromise;
	}

	private async closeResources(): Promise<void> {
		this.disconnected = true;
		this.stop.abort(new Error('SSH connection closing'));
		for (const listener of [...this.closeListeners]) {
			try {
				listener('disconnected');
			} catch {
				/* preserve owner */
			}
		}
		this.closeListeners.clear();
		for (const channel of [...this.channels]) {
			channel.close();
		}
		const leaseResults = await Promise.allSettled([...this.leases].map((lease) => lease.close()));
		await Promise.all(this.route.clients.map(closeClient));
		for (const socket of this.route.sockets) {
			socket.destroy();
		}
		const failures = leaseResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
		if (failures.length) {
			throw new AggregateError(
				failures.map((result) => result.reason),
				'SFTP leases failed to close',
			);
		}
	}
}

export class Ssh2MachineFactory implements MachineSshFactory {
	async connect(endpoint: MachineEndpoint, options: MachineConnectOptions): Promise<MachineConnection> {
		const route = await openSshRoute(endpoint, options);
		if (options.signal?.aborted) {
			for (const client of route.clients) {
				client.destroy();
			}
			for (const socket of route.sockets) {
				socket.destroy();
			}
			throw new DOMException('SSH connection aborted', 'AbortError');
		}
		try {
			return new ConnectedMachine(route);
		} catch (error) {
			for (const client of route.clients) {
				client.destroy();
			}
			for (const socket of route.sockets) {
				socket.destroy();
			}
			throw error;
		}
	}
}
