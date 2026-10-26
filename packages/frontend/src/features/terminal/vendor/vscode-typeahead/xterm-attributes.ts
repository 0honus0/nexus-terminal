/* Microsoft VS Code TypeAhead adaptation; MIT, see LICENSE.txt and README.md. */
import type { IBufferCell, Terminal } from '@xterm/xterm';

export type XtermAttributes = Pick<
	IBufferCell,
	| 'isAttributeDefault'
	| 'isBold'
	| 'isDim'
	| 'isItalic'
	| 'isUnderline'
	| 'isBlink'
	| 'isInverse'
	| 'isInvisible'
	| 'isStrikethrough'
	| 'isOverline'
	| 'isFgRGB'
	| 'isFgPalette'
	| 'isFgDefault'
	| 'getFgColor'
	| 'isBgRGB'
	| 'isBgPalette'
	| 'isBgDefault'
	| 'getBgColor'
>;

const record = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

// xterm 6 has no public current-SGR, cursor-visibility or scrolling-margin getter.
// Validate this one private boundary; an upstream layout change disables prediction.
const coreOf = (terminal: Terminal) => record(record(terminal)?._core);

export function readCurrentAttributes(terminal: Terminal): XtermAttributes | undefined {
	const attrs = record(record(coreOf(terminal)?._inputHandler)?._curAttrData);
	const methods: Array<keyof XtermAttributes> = [
		'isAttributeDefault',
		'isBold',
		'isDim',
		'isItalic',
		'isUnderline',
		'isBlink',
		'isInverse',
		'isInvisible',
		'isStrikethrough',
		'isOverline',
		'isFgRGB',
		'isFgPalette',
		'isFgDefault',
		'getFgColor',
		'isBgRGB',
		'isBgPalette',
		'isBgDefault',
		'getBgColor',
	];
	if (!attrs || methods.some((key) => typeof attrs[key] !== 'function')) return undefined;
	// Methods verified above belong to xterm's AttributeData, also implemented by IBufferCell.
	return attrs as unknown as XtermAttributes;
}

export function supportsPrediction(terminal: Terminal): boolean {
	const core = coreOf(terminal);
	const service = record(core?.coreService);
	const buffer = record(record(core?._bufferService)?.buffer);
	return (
		service?.isCursorHidden === false &&
		buffer?.scrollTop === 0 &&
		typeof buffer?.scrollBottom === 'number' &&
		(buffer.scrollBottom === terminal.rows - 1 || terminal.buffer.active.cursorY > buffer.scrollBottom) &&
		readCurrentAttributes(terminal) !== undefined
	);
}
