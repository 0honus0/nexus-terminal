import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';
import type {
  SuspendedTerminalCheckpoint,
  SuspendedTerminalCheckpointFactory,
  SuspendedTerminalCheckpointSnapshot,
  SuspendedTerminalViewport,
} from '../../modules/ssh-suspend/suspended-terminal-checkpoint.port';

const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024;
const MAX_SCROLLBACK_LINES = 1000;

const validViewport = (viewport: SuspendedTerminalViewport): SuspendedTerminalViewport => ({
  columns: Math.max(2, Math.min(1000, Math.floor(viewport.columns))),
  rows: Math.max(1, Math.min(500, Math.floor(viewport.rows))),
});

class XtermSuspendedTerminalCheckpoint implements SuspendedTerminalCheckpoint {
  private terminal: Terminal;
  private addon: SerializeAddon;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(snapshot: string | undefined, viewport: SuspendedTerminalViewport) {
    const normalized = validViewport(viewport);
    this.terminal = this.createTerminal(normalized);
    this.addon = this.createAddon(this.terminal);
    if (snapshot) this.chain = this.writeToTerminal(snapshot);
  }

  write(data: string | Uint8Array): Promise<void> {
    return this.enqueue(() => this.writeToTerminal(data));
  }

  resize(viewport: SuspendedTerminalViewport): Promise<void> {
    const normalized = validViewport(viewport);
    return this.enqueue(async () => {
      this.terminal.resize(normalized.columns, normalized.rows);
    });
  }

  reset(snapshot: string, viewport: SuspendedTerminalViewport): Promise<void> {
    const normalized = validViewport(viewport);
    return this.enqueue(async () => {
      this.terminal.dispose();
      this.terminal = this.createTerminal(normalized);
      this.addon = this.createAddon(this.terminal);
      if (snapshot) await this.writeToTerminal(snapshot);
    });
  }

  async snapshot(): Promise<SuspendedTerminalCheckpointSnapshot> {
    await this.chain;
    if (this.disposed) throw new Error('Suspended terminal checkpoint is disposed.');
    const data = this.addon.serialize({ scrollback: 0 });
    if (Buffer.byteLength(data, 'utf8') > MAX_CHECKPOINT_BYTES) {
      throw new Error('Suspended terminal checkpoint exceeds the bounded snapshot size.');
    }
    return { data, columns: this.terminal.cols, rows: this.terminal.rows };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.chain.catch(() => undefined).then(() => this.terminal.dispose());
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Suspended terminal checkpoint is disposed.'));
    const next = this.chain.catch(() => undefined).then(operation);
    this.chain = next;
    return next;
  }

  private writeToTerminal(data: string | Uint8Array): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Suspended terminal checkpoint is disposed.'));
    return new Promise((resolve) => this.terminal.write(data, resolve));
  }

  private createTerminal(viewport: SuspendedTerminalViewport): Terminal {
    return new Terminal({
      cols: viewport.columns,
      rows: viewport.rows,
      scrollback: MAX_SCROLLBACK_LINES,
      allowProposedApi: true,
    });
  }

  private createAddon(terminal: Terminal): SerializeAddon {
    const addon = new SerializeAddon();
    terminal.loadAddon(addon);
    return addon;
  }
}

export class XtermSuspendedTerminalCheckpointFactory implements SuspendedTerminalCheckpointFactory {
  create(snapshot: string | undefined, viewport: SuspendedTerminalViewport): SuspendedTerminalCheckpoint {
    return new XtermSuspendedTerminalCheckpoint(snapshot, viewport);
  }
}
