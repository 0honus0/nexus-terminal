import { TerminalCleanupFailure } from '../terminal-errors.js';
import serialization, { type SerializeAddon } from '@xterm/addon-serialize';
import headless, { type Terminal } from '@xterm/headless';
import type {
	SuspendedCheckpointFactory,
	SuspendedTerminalCheckpoint,
	SuspendedTerminalCheckpointView,
	SuspendedViewport,
} from '../suspended-checkpoint-port.js';

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const SCROLLBACK_LINES = 1000;
type MouseEncoding = 'default' | 'sgr' | 'sgr-pixels';

function modeTracker(terminal: Terminal): { restore(): string; dispose(): void } {
	let mouseEncoding: MouseEncoding = 'default';

	const handler =
		(enabled: boolean) =>
		(params: (number | number[])[]): boolean => {
			for (const value of params) {
				const mode = Array.isArray(value) ? value[0] : value;
				if (mode === 1006) {
					mouseEncoding = enabled ? 'sgr' : 'default';
				}
				if (mode === 1016) {
					mouseEncoding = enabled ? 'sgr-pixels' : 'default';
				}
			}
			return false;
		};

	const subscriptions = [
		terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, handler(true)),
		terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, handler(false)),
	];
	return {
		restore: () =>
			mouseEncoding === 'sgr' ? '\u001b[?1006h' : mouseEncoding === 'sgr-pixels' ? '\u001b[?1016h' : '',

		dispose: () => {
			const failures: unknown[] = [];
			for (const off of subscriptions) {
				try {
					off.dispose();
				} catch (error) {
					failures.push(error);
				}
			}
			if (failures.length) {
				throw new TerminalCleanupFailure(failures);
			}
		},
	};
}

function validViewport(view: SuspendedViewport): SuspendedViewport {
	if (
		!Number.isSafeInteger(view.columns) ||
		view.columns < 2 ||
		view.columns > 1000 ||
		!Number.isSafeInteger(view.rows) ||
		view.rows < 1 ||
		view.rows > 500
	) {
		throw new RangeError('Invalid suspended terminal viewport');
	}
	return view;
}

class HeadlessCheckpoint implements SuspendedTerminalCheckpoint {
	private terminal: Terminal;
	private addon: SerializeAddon;
	private modes: ReturnType<typeof modeTracker>;
	private tail: Promise<void> = Promise.resolve();
	private disposed = false;
	private closePromise: Promise<void> | null = null;

	constructor(initial: string | undefined, view: SuspendedViewport) {
		this.terminal = this.makeTerminal(view);
		try {
			this.addon = this.makeAddon();
			this.modes = modeTracker(this.terminal);
		} catch (error) {
			try {
				this.terminal.dispose();
			} catch (cleanup) {
				throw new TerminalCleanupFailure([error, cleanup]);
			}
			throw error;
		}
		if (initial) {
			this.tail = this.writeToTerminal(initial);
			void this.tail.catch(() => undefined);
		}
	}

	private makeTerminal(view: SuspendedViewport): Terminal {
		const valid = validViewport(view);
		return new headless.Terminal({
			cols: valid.columns,
			rows: valid.rows,
			scrollback: SCROLLBACK_LINES,
			allowProposedApi: true,
		});
	}

	private makeAddon(): SerializeAddon {
		const addon = new serialization.SerializeAddon();
		this.terminal.loadAddon(addon);
		return addon;
	}

	private writeToTerminal(data: string | Uint8Array): Promise<void> {
		return new Promise((resolve) => this.terminal.write(data, resolve));
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		if (this.disposed) {
			return Promise.reject(new Error('Checkpoint disposed'));
		}
		const next = this.tail.then(task);
		this.tail = next;
		return next;
	}

	write(data: Uint8Array | string): Promise<void> {
		return this.enqueue(() => this.writeToTerminal(data));
	}

	resize(view: SuspendedViewport): Promise<void> {
		const valid = validViewport(view);
		return this.enqueue(async () => {
			this.terminal.resize(valid.columns, valid.rows);
		});
	}

	reset(data: string, view: SuspendedViewport): Promise<void> {
		const valid = validViewport(view);
		return this.enqueue(async () => {
			const failures: unknown[] = [];
			try {
				this.modes.dispose();
			} catch (error) {
				failures.push(error);
			}
			try {
				this.terminal.dispose();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) {
				throw new TerminalCleanupFailure(failures);
			}
			this.terminal = this.makeTerminal(valid);
			this.addon = this.makeAddon();
			this.modes = modeTracker(this.terminal);
			if (data) {
				await this.writeToTerminal(data);
			}
		});
	}

	async snapshot(): Promise<SuspendedTerminalCheckpointView> {
		await this.tail;
		if (this.disposed) {
			throw new Error('Checkpoint disposed');
		}
		const data = this.addon.serialize({ scrollback: 0 }) + this.modes.restore();
		if (Buffer.byteLength(data, 'utf8') > MAX_SNAPSHOT_BYTES) {
			throw new RangeError('Suspended checkpoint exceeds four MiB');
		}
		return { data, columns: this.terminal.cols, rows: this.terminal.rows };
	}

	dispose(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.disposed = true;
		this.closePromise = Promise.resolve().then(async () => {
			// Rendering failure can fall back to raw history; disposal failures cannot.
			await this.tail.catch(() => undefined);
			const failures: unknown[] = [];
			try {
				this.modes.dispose();
			} catch (error) {
				failures.push(error);
			}
			try {
				this.terminal.dispose();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) {
				throw new TerminalCleanupFailure(failures);
			}
		});
		return this.closePromise;
	}
}

export class HeadlessSuspendedCheckpointFactory implements SuspendedCheckpointFactory {
	create(initial: string | undefined, viewport: SuspendedViewport): SuspendedTerminalCheckpoint {
		return new HeadlessCheckpoint(initial, viewport);
	}
}
