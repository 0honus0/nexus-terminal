import type { Readable } from 'node:stream';
import type { SuspendedTerminalViewport } from './suspended-terminal-checkpoint.port';

export interface SuspendedTerminalLogExporter {
	render(source: Readable, viewport: SuspendedTerminalViewport): Promise<Readable>;
}
