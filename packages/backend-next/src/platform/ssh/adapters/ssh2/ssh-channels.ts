import type { ClientChannel } from 'ssh2';
import type { MachineByteChannel, MachineShell, MachineCommand, MachineCommandOutcome } from '../../ssh-port.js';

function notify<T extends unknown[]>(listeners: Set<(...args: T) => void>, ...args: T): void {
	for (const listener of listeners) {
		try {
			listener(...args);
		} catch {
			/* listeners cannot break transport state */
		}
	}
}

class ByteChannel implements MachineByteChannel {
	readonly readable: ClientChannel;
	readonly writable: ClientChannel;
	private readonly stderr = new Set<(bytes: Uint8Array) => void>();
	private readonly drains = new Set<() => void>();
	private readonly closes = new Set<() => void>();
	private ended = false;

	constructor(
		protected readonly channel: ClientChannel,
		onEnded: () => void,
	) {
		this.readable = channel;
		this.writable = channel;
		channel.stderr.on('data', (chunk: Buffer | string) =>
			notify(this.stderr, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
		);
		channel.on('drain', () => notify(this.drains));
		channel.on('close', () => {
			if (this.ended) {
				return;
			}
			this.ended = true;
			notify(this.closes);
			this.drains.clear();
			this.stderr.clear();
			this.closes.clear();
			onEnded();
		});
		// SSH channel errors may precede close. They must not be unhandled events.
		channel.on('error', () => undefined);
	}

	onStderr(listener: (bytes: Uint8Array) => void): () => void {
		this.stderr.add(listener);
		return () => this.stderr.delete(listener);
	}

	onClose(listener: () => void): () => void {
		if (this.ended) {
			queueMicrotask(listener);
			return () => undefined;
		}
		this.closes.add(listener);
		return () => this.closes.delete(listener);
	}

	onDrain(listener: () => void): () => void {
		this.drains.add(listener);
		return () => this.drains.delete(listener);
	}

	pause(): void {
		this.channel.pause();
	}

	resume(): void {
		this.channel.resume();
	}

	close(): void {
		if (this.channel.destroyed) {
			return;
		}
		this.channel.close();
		this.channel.destroy();
	}
}

export class SshShellChannel extends ByteChannel implements MachineShell {
	resize(columns: number, rows: number): void {
		if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
			throw new Error('Invalid PTY size');
		}
		this.channel.setWindow(rows, columns, 0, 0);
	}
}

export class SshCommandChannel extends ByteChannel implements MachineCommand {
	readonly outcome: Promise<MachineCommandOutcome>;
	// The Promise constructor runs its executor synchronously before any channel event.
	private settle!: (value: MachineCommandOutcome) => void;
	private settled = false;

	constructor(channel: ClientChannel, onEnded: () => void) {
		super(channel, onEnded);
		this.outcome = new Promise((resolve) => {
			this.settle = resolve;
		});
		channel.on('close', (code: number | null, signal?: string | null) => {
			if (typeof code !== 'number' || !Number.isInteger(code)) {
				this.finish({ status: 'unknown', reason: 'disconnect' });
			} else if (code === 0) {
				this.finish({ status: 'completed', exitCode: 0, signal: signal ?? null });
			} else {
				this.finish({ status: 'nonzero', exitCode: code, signal: signal ?? null });
			}
		});
		channel.on('error', () => this.finish({ status: 'unknown', reason: 'channel_error' }));
	}

	private finish(result: MachineCommandOutcome): void {
		if (this.settled) {
			return;
		}
		this.settled = true;
		this.settle(result);
	}

	cancel(reason: 'cancelled' | 'timeout' = 'cancelled'): void {
		this.finish({ status: 'unknown', reason });
		this.close();
	}
}
