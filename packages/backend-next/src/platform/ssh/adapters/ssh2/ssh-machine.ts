import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2';
import type { Duplex } from 'node:stream';
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
	MachineCommandOutcome,
} from '../../ssh-port.js';
import { openSshRoute, type ConnectedRoute } from './ssh-route.js';
import { SshShellChannel, SshCommandChannel } from './ssh-channels.js';
import { SshSftpLease } from './ssh-sftp.js';

function timeoutError(): Error {
	return new Error('SSH channel request timed out');
}

class ConnectedMachine implements MachineConnection {
	private readonly closeListeners = new Set<() => void>();
	private readonly channels = new Set<MachineShell | SshCommandChannel>();
	private readonly leases = new Set<SshSftpLease>();
	private readonly stop = new AbortController();
	private closePromise: Promise<void> | null = null;
	private disconnected = false;

	constructor(private readonly route: ConnectedRoute) {
		for (const client of route.clients) {
			client.on('error', () => this.disconnectedByRemote());
			client.on('close', () => this.disconnectedByRemote());
		}
	}

	get isOpen(): boolean {
		return !this.disconnected && this.closePromise === null;
	}

	private disconnectedByRemote(): void {
		if (this.disconnected) return;
		this.disconnected = true;
		this.stop.abort(new Error('SSH transport disconnected'));
		for (const listener of [...this.closeListeners]) {
			try {
				listener();
			} catch {
				/* callbacks do not change resource owner */
			}
		}
		this.closeListeners.clear();
		void this.close().catch(() => undefined);
	}

	onClose(listener: () => void): () => void {
		if (!this.isOpen) {
			queueMicrotask(listener);
			return () => undefined;
		}
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	private ensure(): Client {
		if (!this.isOpen) throw new Error('SSH machine connection closed');
		return this.route.primary;
	}

	private async openChannel(
		create: (client: Client, callback: (error: Error | undefined, channel: ClientChannel) => void) => void,
		signal?: AbortSignal,
	): Promise<ClientChannel> {
		const client = this.ensure();
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
				} else resolve(channel!);
			};

			const disconnected = () => finish(new Error('SSH transport disconnected'));

			const failed = (error: Error) => finish(error);

			const aborted = () => finish(new DOMException('SSH channel aborted', 'AbortError'));

			const timeout = setTimeout(() => finish(timeoutError()), 30000);
			client.once('close', disconnected);
			client.once('error', failed);
			signal?.addEventListener('abort', aborted, { once: true });
			this.stop.signal.addEventListener('abort', aborted, { once: true });
			if (signal?.aborted || this.stop.signal.aborted) return aborted();
			try {
				create(client, (error, channel) => finish(error, channel));
			} catch (error) {
				finish(error instanceof Error ? error : new Error('SSH channel rejected'));
			}
		});
	}

	async openShell(pty: MachinePty, signal?: AbortSignal): Promise<MachineShell> {
		if (!Number.isInteger(pty.columns) || !Number.isInteger(pty.rows) || pty.columns < 1 || pty.rows < 1)
			throw new Error('Invalid terminal dimensions');
		const channel = await this.openChannel(
			(client, callback) =>
				client.shell({ term: pty.term ?? 'xterm-256color', cols: pty.columns, rows: pty.rows }, callback),
			signal,
		);
		const shell = new SshShellChannel(channel, () => this.channels.delete(shell));
		this.channels.add(shell);
		return shell;
	}

	private async openCommand(
		command: string,
		signal?: AbortSignal,
		cancelWhenAborted = true,
	): Promise<MachineCommand> {
		if (!command) throw new Error('Empty SSH command');
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
			if (signal.aborted) abort();
		}
		return result;
	}

	openRawCommand(command: string, signal?: AbortSignal): Promise<MachineCommand> {
		return this.openCommand(command, signal);
	}

	startCommand(command: string, signal?: AbortSignal): Promise<MachineCommand> {
		return this.openRawCommand(command, signal);
	}

	async execute(
		command: string,
		options: { timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal },
	): Promise<MachineCommandResult> {
		if (
			!Number.isSafeInteger(options.maxOutputBytes) ||
			options.maxOutputBytes < 1 ||
			options.maxOutputBytes > 16 * 1024 * 1024
		)
			throw new Error('Invalid command output budget');
		if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 300000)
			throw new Error('Invalid command timeout');
		options.signal?.throwIfAborted();
		const controller = new AbortController();

		const abort = () => controller.abort(options.signal?.reason);

		options.signal?.addEventListener('abort', abort, { once: true });
		const timeout = setTimeout(() => controller.abort(new Error('SSH command timeout')), options.timeoutMs);
		let commandChannel: MachineCommand | null = null;
		try {
			commandChannel = await this.openCommand(command, controller.signal, false);
			const channel = commandChannel;
			const outputs: Buffer[][] = [[], []];
			let size = 0;
			let truncated = false;

			const collect = (index: number, data: Buffer | string) => {
				const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
				const available = options.maxOutputBytes - size;
				if (bytes.length > available) truncated = true;
				if (available > 0) {
					const item = bytes.subarray(0, Math.min(bytes.length, available));
					outputs[index].push(item);
					size += item.length;
				}
			};

			channel.readable.on('data', (data: Buffer | string) => collect(0, data));
			const unsubscribe = channel.onStderr((bytes) => collect(1, Buffer.from(bytes)));

			const abortCommand = () =>
				(channel as SshCommandChannel).cancel(options.signal?.aborted ? 'cancelled' : 'timeout');

			controller.signal.addEventListener('abort', abortCommand, { once: true });
			if (controller.signal.aborted) abortCommand();
			const outcome: MachineCommandOutcome = await channel.outcome;
			controller.signal.removeEventListener('abort', abortCommand);
			unsubscribe();
			return {
				outcome,
				stdout: Buffer.concat(outputs[0]).toString('utf8'),
				stderr: Buffer.concat(outputs[1]).toString('utf8'),
				truncated,
			};
		} finally {
			clearTimeout(timeout);
			options.signal?.removeEventListener('abort', abort);
			commandChannel?.close();
		}
	}

	async openSftp(signal?: AbortSignal): Promise<MachineSftpLease> {
		const client = this.ensure();
		const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
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
				} else resolve(channel!);
			};

			const aborted = () => finish(new DOMException('SFTP opening cancelled', 'AbortError'));

			const lost = () => finish(new Error('SSH connection closed'));

			const failed = (error: Error) => finish(error);

			const timer = setTimeout(() => finish(new Error('SFTP opening timed out')), 30000);
			signal?.addEventListener('abort', aborted, { once: true });
			this.stop.signal.addEventListener('abort', aborted, { once: true });
			client.once('close', lost);
			client.once('error', failed);
			if (signal?.aborted || this.stop.signal.aborted) return aborted();
			try {
				client.sftp((error, channel) => finish(error, channel));
			} catch (error) {
				finish(error instanceof Error ? error : new Error('SFTP request rejected'));
			}
		});
		const lease = new SshSftpLease(sftp, () => this.leases.delete(lease));
		this.leases.add(lease);
		return lease;
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closePromise = (async () => {
			this.disconnected = true;
			this.stop.abort(new Error('SSH connection closing'));
			for (const listener of [...this.closeListeners]) {
				try {
					listener();
				} catch {
					/* preserve owner */
				}
			}
			this.closeListeners.clear();
			for (const channel of [...this.channels]) channel.close();
			await Promise.allSettled([...this.leases].map((lease) => lease.close()));
			const closings = this.route.clients.map(
				(client) =>
					new Promise<void>((resolve) => {
						const timer = setTimeout(() => {
							client.destroy();
							resolve();
						}, 2000);
						client.once('close', () => {
							clearTimeout(timer);
							resolve();
						});
						client.end();
					}),
			);
			await Promise.all(closings);
			for (const socket of this.route.sockets) socket.destroy();
		})();
		return this.closePromise;
	}
}

export class Ssh2MachineFactory implements MachineSshFactory {
	async connect(endpoint: MachineEndpoint, options: MachineConnectOptions): Promise<MachineConnection> {
		const route = await openSshRoute(endpoint, options);
		if (options.signal?.aborted) {
			for (const client of route.clients) client.destroy();
			for (const socket of route.sockets) socket.destroy();
			throw new DOMException('SSH connection aborted', 'AbortError');
		}
		return new ConnectedMachine(route);
	}
}
