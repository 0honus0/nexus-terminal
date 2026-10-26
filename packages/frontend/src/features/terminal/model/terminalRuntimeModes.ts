import type { Terminal } from '@xterm/xterm';

type MouseEncoding = 'default' | 'sgr' | 'sgr-pixels';

export interface TerminalRuntimeModeTracker {
	restoreSuffix(): string;
	reset(): void;
	dispose(): void;
}

/** Tracks xterm runtime modes that SerializeAddon 0.14 does not include in snapshots. */
export function trackTerminalRuntimeModes(terminal: Terminal): TerminalRuntimeModeTracker {
	let mouseEncoding: MouseEncoding = 'default';
	const regions = {
		normal: { top: 1, bottom: terminal.rows },
		alternate: { top: 1, bottom: terminal.rows },
	};

	const resetRegions = (): void => {
		regions.normal = { top: 1, bottom: terminal.rows };
		regions.alternate = { top: 1, bottom: terminal.rows };
	};

	const captureRegion = (params: (number | number[])[]): boolean => {
		const top = typeof params[0] === 'number' ? params[0] || 1 : 1;
		const requestedBottom = typeof params[1] === 'number' ? params[1] : 0;
		const bottom = !requestedBottom || requestedBottom > terminal.rows ? terminal.rows : requestedBottom;
		// Match xterm's DECSTBM acceptance; the registered handler observes, never consumes it.
		if (bottom > top) regions[terminal.buffer.active.type] = { top, bottom };
		return false;
	};

	const restoreRegion = (): string => {
		const { top, bottom } = regions[terminal.buffer.active.type];
		if (top === 1 && bottom === terminal.rows) return '';
		const buffer = terminal.buffer.active;
		const originMode = terminal.modes.originMode;
		const row = originMode ? buffer.cursorY - top + 2 : buffer.cursorY + 1;
		// Setting margins homes the cursor. Restore DECOM and its cursor after applying them.
		return `\x1b[?6l\x1b[${top};${bottom}r${originMode ? '\x1b[?6h' : ''}\x1b[${row};${buffer.cursorX + 1}H`;
	};

	const apply =
		(enabled: boolean) =>
		(params: (number | number[])[]): boolean => {
			for (const param of params) {
				const mode = Array.isArray(param) ? param[0] : param;
				if (mode === 1006) mouseEncoding = enabled ? 'sgr' : 'default';
				else if (mode === 1016) mouseEncoding = enabled ? 'sgr-pixels' : 'default';
			}
			return false;
		};

	const disposables = [
		terminal.parser.registerCsiHandler({ final: 'r' }, captureRegion),
		terminal.parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => {
			regions[terminal.buffer.active.type] = { top: 1, bottom: terminal.rows };
			return false;
		}),
		terminal.onResize(resetRegions),
		terminal.buffer.onBufferChange((buffer) => {
			if (buffer.type === 'normal') regions.alternate = { top: 1, bottom: terminal.rows };
		}),

		terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, apply(true)),
		terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, apply(false)),
		terminal.parser.registerEscHandler({ final: 'c' }, () => {
			mouseEncoding = 'default';
			resetRegions();
			return false;
		}),
	];
	return {
		restoreSuffix() {
			let suffix = '';
			if (mouseEncoding === 'sgr') suffix += '\u001b[?1006h';
			else if (mouseEncoding === 'sgr-pixels') suffix += '\u001b[?1016h';
			return suffix + restoreRegion();
		},

		reset() {
			mouseEncoding = 'default';
			resetRegions();
		},

		dispose() {
			for (const disposable of disposables) disposable.dispose();
		},
	};
}
