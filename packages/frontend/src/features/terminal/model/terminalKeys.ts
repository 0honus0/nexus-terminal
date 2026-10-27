export type TerminalFunctionKey = 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8' | 'f9' | 'f10' | 'f11' | 'f12';

export type TerminalKey =
	| 'escape'
	| 'tab'
	| 'backspace'
	| 'delete'
	| 'insert'
	| 'home'
	| 'end'
	| 'pageUp'
	| 'pageDown'
	| 'arrowUp'
	| 'arrowDown'
	| 'arrowLeft'
	| 'arrowRight'
	| TerminalFunctionKey;

export interface TerminalKeyEncodingMode {
	/** DECCKM: the remote application requested SS3 cursor keys (`CSI ? 1 h`). */
	applicationCursorKeys: boolean;
}

const FIXED_SEQUENCES: Record<
	Exclude<TerminalKey, 'arrowUp' | 'arrowDown' | 'arrowLeft' | 'arrowRight' | 'home' | 'end'>,
	string
> = {
	escape: '\x1b',
	tab: '\t',
	backspace: '\x7f',
	delete: '\x1b[3~',
	insert: '\x1b[2~',
	pageUp: '\x1b[5~',
	pageDown: '\x1b[6~',
	f1: '\x1bOP',
	f2: '\x1bOQ',
	f3: '\x1bOR',
	f4: '\x1bOS',
	f5: '\x1b[15~',
	f6: '\x1b[17~',
	f7: '\x1b[18~',
	f8: '\x1b[19~',
	f9: '\x1b[20~',
	f10: '\x1b[21~',
	f11: '\x1b[23~',
	f12: '\x1b[24~',
};

const CURSOR_FINAL: Record<'arrowUp' | 'arrowDown' | 'arrowRight' | 'arrowLeft' | 'home' | 'end', string> = {
	arrowUp: 'A',
	arrowDown: 'B',
	arrowRight: 'C',
	arrowLeft: 'D',
	home: 'H',
	end: 'F',
};

/**
 * Encode one unmodified key the way xterm (TERM=xterm-256color) does. Cursor and
 * Home/End keys follow the terminal's current DECCKM mode; sticky modifiers are applied
 * afterwards by `applyTerminalModifiers`.
 */
export const encodeTerminalKey = (key: TerminalKey, mode: TerminalKeyEncodingMode): string => {
	if (key in CURSOR_FINAL) {
		const final = CURSOR_FINAL[key as keyof typeof CURSOR_FINAL];
		return `\x1b${mode.applicationCursorKeys ? 'O' : '['}${final}`;
	}
	return FIXED_SEQUENCES[key as keyof typeof FIXED_SEQUENCES];
};
