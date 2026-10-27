/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE.txt in this directory.
 * Adapted from microsoft/vscode ae11932c6109d3977d78f2fe8937d861e246151d.
 * See README.md for provenance and Nexus integration changes.
 */
import mitt from 'mitt';
import type { IBuffer, IBufferCell, Terminal } from '@xterm/xterm';
import { readCurrentAttributes, supportsPrediction, type XtermAttributes } from './xterm-attributes';

const enum VT {
	Esc = '\x1b',
	Csi = `\x1b[`,
	DeleteChar = `\x1b[X`,
}

const CSI_STYLE_RE = /^\x1b\[[0-9;]*m/;
const CSI_MOVE_RE = /^\x1b\[?([0-9]*)(;[35])?O?([DC])/;
const NOT_WORD_RE = /[^a-z0-9]/i;

const enum StatsConstants {
	StatsBufferSize = 24,
	StatsMinSamplesToTurnOn = 5,
	StatsMinAccuracyToTurnOn = 0.3,
}

/**
 * Codes that should be omitted from sending to the prediction engine and instead omitted directly:
 * - Hide cursor (DECTCEM): We wrap the local echo sequence in hide and show
 *   CSI ? 2 5 l
 * - Show cursor (DECTCEM): We wrap the local echo sequence in hide and show
 *   CSI ? 2 5 h
 * - Device Status Report (DSR): These sequence fire report events from xterm which could cause
 *   double reporting and potentially a stack overflow (#119472)
 *   CSI Ps n
 *   CSI ? Ps n
 */
const PREDICTION_OMIT_RE = /^(\x1b\[(\??25[hl]|\??[0-9;]+n))+/;

const enum CursorMoveDirection {
	Back = 'D',
	Forwards = 'C',
}

interface ICoordinate {
	x: number;
	y: number;
	baseY: number;
}

class Cursor implements ICoordinate {
	private _x = 0;
	private _y = 1;
	private _baseY = 1;

	get x() {
		return this._x;
	}

	get y() {
		return this._y;
	}

	get baseY() {
		return this._baseY;
	}

	get coordinate(): ICoordinate {
		return { x: this._x, y: this._y, baseY: this._baseY };
	}

	constructor(
		readonly rows: number,
		readonly cols: number,
		private readonly _buffer: IBuffer,
	) {
		this._x = _buffer.cursorX;
		this._y = _buffer.cursorY;
		this._baseY = _buffer.baseY;
	}

	getLine() {
		return this._buffer.getLine(this._y + this._baseY);
	}

	getCell(loadInto?: IBufferCell) {
		return this.getLine()?.getCell(this._x, loadInto);
	}

	moveTo(coordinate: ICoordinate) {
		this._x = coordinate.x;
		this._y = coordinate.y + coordinate.baseY - this._baseY;
		return this.moveInstruction();
	}

	clone() {
		const c = new Cursor(this.rows, this.cols, this._buffer);
		c.moveTo(this);
		return c;
	}

	move(x: number, y: number) {
		this._x = x;
		this._y = y;
		return this.moveInstruction();
	}

	shift(x: number = 0, y: number = 0) {
		this._x += x;
		this._y += y;
		return this.moveInstruction();
	}

	moveInstruction() {
		if (this._y >= this.rows) {
			this._baseY += this._y - (this.rows - 1);
			this._y = this.rows - 1;
		} else if (this._y < 0) {
			this._baseY -= this._y;
			this._y = 0;
		}

		return `${VT.Csi}${this._y + 1};${this._x + 1}H`;
	}
}

const moveToWordBoundary = (b: IBuffer, cursor: Cursor, direction: -1 | 1) => {
	let ateLeadingWhitespace = false;
	if (direction < 0) {
		cursor.shift(-1);
	}

	let cell: IBufferCell | undefined;
	while (cursor.x >= 0) {
		cell = cursor.getCell(cell);
		if (!cell?.getCode()) {
			return;
		}

		const chars = cell.getChars();
		if (NOT_WORD_RE.test(chars)) {
			if (ateLeadingWhitespace) {
				break;
			}
		} else {
			ateLeadingWhitespace = true;
		}

		cursor.shift(direction);
	}

	if (direction < 0) {
		cursor.shift(1); // we want to place the cursor after the whitespace starting the word
	}
};

const enum MatchResult {
	/** matched successfully */
	Success,
	/** failed to match */
	Failure,
	/** buffer data, it might match in the future one more data comes in */
	Buffer,
}

interface IPrediction {
	/**
	 * Whether applying this prediction can modify the style attributes of the
	 * terminal. If so it means we need to reset the cursor style if it's
	 * rolled back.
	 */
	readonly affectsStyle?: boolean;

	/**
	 * If set to false, the prediction will not be cleared if no input is
	 * received from the server.
	 */
	readonly clearAfterTimeout?: boolean;

	/**
	 * Returns a sequence to apply the prediction.
	 * @param buffer to write to
	 * @param cursor position to write the data. Should advance the cursor.
	 * @returns a string to be written to the user terminal, or optionally a
	 * string for the user terminal and real pty.
	 */
	apply(buffer: IBuffer, cursor: Cursor): string;

	/**
	 * Returns a sequence to roll back a previous `apply()` call. If
	 * `rollForwards` is not given, then this is also called if a prediction
	 * is correct before show the user's data.
	 */
	rollback(cursor: Cursor): string;

	/**
	 * If available, this will be called when the prediction is correct.
	 */
	rollForwards(cursor: Cursor, withInput: string): string;

	/**
	 * Returns whether the given input is one expected by this prediction.
	 * @param input reader for the input the PTY is giving
	 * @param lookBehind the last successfully-made prediction, if any
	 */
	matches(input: StringReader, lookBehind?: IPrediction): MatchResult;
}

class StringReader {
	index = 0;

	get remaining() {
		return this._input.length - this.index;
	}

	get eof() {
		return this.index === this._input.length;
	}

	get rest() {
		return this._input.slice(this.index);
	}

	get hasIncompleteControlSequence() {
		// A network frame may end before a CSI final byte (including SGR/DECTCEM/DSR).
		return /^\x1b(?:\[[0-9;?]*)?$/.test(this.rest);
	}

	constructor(private readonly _input: string) {}

	/**
	 * Advances the reader and returns the character if it matches.
	 */
	eatChar(char: string) {
		if (this._input[this.index] !== char) {
			return;
		}

		this.index++;
		return char;
	}

	/**
	 * Advances the reader and returns the string if it matches.
	 */
	eatStr(substr: string) {
		if (this._input.slice(this.index, this.index + substr.length) !== substr) {
			return;
		}

		this.index += substr.length;
		return substr;
	}

	/**
	 * Matches and eats the substring character-by-character. If EOF is reached
	 * before the substring is consumed, it will buffer. Index is not moved
	 * if it's not a match.
	 */
	eatGradually(substr: string): MatchResult {
		const prevIndex = this.index;
		for (let i = 0; i < substr.length; i++) {
			if (i > 0 && this.eof) {
				return MatchResult.Buffer;
			}

			if (!this.eatChar(substr.charAt(i))) {
				this.index = prevIndex;
				return MatchResult.Failure;
			}
		}

		return MatchResult.Success;
	}

	/**
	 * Advances the reader and returns the regex if it matches.
	 */
	eatRe(re: RegExp) {
		const match = re.exec(this._input.slice(this.index));
		if (!match) {
			return;
		}

		this.index += match[0].length;
		return match;
	}

	/**
	 * Advances the reader and returns the character if the code matches.
	 */
	eatCharCode(min = 0, max = min + 1) {
		const code = this._input.charCodeAt(this.index);
		if (!Number.isFinite(code) || code < min || code >= max) {
			return undefined;
		}

		this.index++;
		return code;
	}
}

/**
 * Preidction which never tests true. Will always discard predictions made
 * after it.
 */
class HardBoundary implements IPrediction {
	readonly clearAfterTimeout = false;

	apply() {
		return '';
	}

	rollback() {
		return '';
	}

	rollForwards() {
		return '';
	}

	matches() {
		return MatchResult.Failure;
	}
}

/**
 * Wraps another prediction. Does not apply the prediction, but will pass
 * through its `matches` request.
 */
class TentativeBoundary implements IPrediction {
	private _appliedCursor?: Cursor;

	constructor(readonly inner: IPrediction) {}

	apply(buffer: IBuffer, cursor: Cursor) {
		this._appliedCursor = cursor.clone();
		this.inner.apply(buffer, this._appliedCursor);
		return '';
	}

	rollback(cursor: Cursor) {
		this.inner.rollback(cursor.clone());
		return '';
	}

	rollForwards(cursor: Cursor, withInput: string) {
		if (this._appliedCursor) {
			cursor.moveTo(this._appliedCursor);
		}

		return withInput;
	}

	matches(input: StringReader) {
		return this.inner.matches(input);
	}
}

const isTenativeCharacterPrediction = (p: unknown): p is TentativeBoundary & { inner: CharacterPrediction } =>
	p instanceof TentativeBoundary && p.inner instanceof CharacterPrediction;

/**
 * Prediction for a single alphanumeric character.
 */
class CharacterPrediction implements IPrediction {
	readonly affectsStyle = true;

	appliedAt?: {
		pos: ICoordinate;
		oldAttributes: string;
		oldChar: string;
	};

	constructor(private readonly _char: string) {}

	apply(_: IBuffer, cursor: Cursor) {
		const cell = cursor.getCell();
		this.appliedAt = cell
			? { pos: cursor.coordinate, oldAttributes: attributesToSeq(cell), oldChar: cell.getChars() }
			: { pos: cursor.coordinate, oldAttributes: '', oldChar: '' };

		cursor.shift(1);

		return this._char;
	}

	rollback(cursor: Cursor) {
		if (!this.appliedAt) {
			return ''; // not applied
		}

		const { oldAttributes, oldChar, pos } = this.appliedAt;
		const r = cursor.moveTo(pos) + oldAttributes + (oldChar ? oldChar + cursor.moveTo(pos) : VT.DeleteChar);
		return r;
	}

	rollForwards(cursor: Cursor, input: string) {
		if (!this.appliedAt) {
			return ''; // not applied
		}

		return cursor.clone().moveTo(this.appliedAt.pos) + input;
	}

	matches(input: StringReader, lookBehind?: IPrediction) {
		const startIndex = input.index;

		// remove any styling CSI before checking the char
		while (input.eatRe(CSI_STYLE_RE)) {}

		if (input.eof || input.hasIncompleteControlSequence) {
			return MatchResult.Buffer;
		}

		if (input.eatChar(this._char)) {
			return MatchResult.Success;
		}

		if (lookBehind instanceof CharacterPrediction) {
			// see #112842
			const sillyZshOutcome = input.eatGradually(`\b${lookBehind._char}${this._char}`);
			if (sillyZshOutcome !== MatchResult.Failure) {
				return sillyZshOutcome;
			}
		}

		input.index = startIndex;
		return MatchResult.Failure;
	}
}

class BackspacePrediction implements IPrediction {
	protected _appliedAt?: {
		pos: ICoordinate;
		oldAttributes: string;
		oldChar: string;
		isLastChar: boolean;
	};

	constructor(private readonly _terminal: Terminal) {}

	apply(_: IBuffer, cursor: Cursor) {
		// at eol if everything to the right is whitespace (zsh will emit a "clear line" code in this case)
		// todo: can be optimized if `getTrimmedLength` is exposed from xterm
		const isLastChar = !cursor.getLine()?.translateToString(undefined, cursor.x).trim();
		const pos = cursor.coordinate;
		const move = cursor.shift(-1);
		const cell = cursor.getCell();
		this._appliedAt = cell
			? { isLastChar, pos, oldAttributes: attributesToSeq(cell), oldChar: cell.getChars() }
			: { isLastChar, pos, oldAttributes: '', oldChar: '' };

		return move + VT.DeleteChar;
	}

	rollback(cursor: Cursor) {
		if (!this._appliedAt) {
			return ''; // not applied
		}

		const { oldAttributes, oldChar, pos } = this._appliedAt;
		if (!oldChar) {
			return cursor.moveTo(pos) + VT.DeleteChar;
		}

		return oldAttributes + oldChar + cursor.moveTo(pos) + attributesToSeq(readCurrentAttributes(this._terminal));
	}

	rollForwards() {
		return '';
	}

	matches(input: StringReader) {
		if (this._appliedAt?.isLastChar) {
			const r1 = input.eatGradually(`\b${VT.Csi}K`);
			if (r1 !== MatchResult.Failure) {
				return r1;
			}

			const r2 = input.eatGradually(`\b \b`);
			if (r2 !== MatchResult.Failure) {
				return r2;
			}
		}

		return MatchResult.Failure;
	}
}

class NewlinePrediction implements IPrediction {
	protected _prevPosition?: ICoordinate;

	apply(_: IBuffer, cursor: Cursor) {
		this._prevPosition = cursor.coordinate;
		cursor.move(0, cursor.y + 1);
		return '\r\n';
	}

	rollback(cursor: Cursor) {
		return this._prevPosition ? cursor.moveTo(this._prevPosition) : '';
	}

	rollForwards() {
		return ''; // does not need to rewrite
	}

	matches(input: StringReader) {
		return input.eatGradually('\r\n');
	}
}

class CursorMovePrediction implements IPrediction {
	private _applied?: {
		rollForward: string;
		prevPosition: number;
		prevAttrs: string;
		amount: number;
	};

	constructor(
		private readonly _direction: CursorMoveDirection,
		private readonly _moveByWords: boolean,
		private readonly _amount: number,
	) {}

	apply(buffer: IBuffer, cursor: Cursor) {
		const prevPosition = cursor.x;
		const currentCell = cursor.getCell();
		const prevAttrs = currentCell ? attributesToSeq(currentCell) : '';

		const { _amount: amount, _direction: direction, _moveByWords: moveByWords } = this;
		const delta = direction === CursorMoveDirection.Back ? -1 : 1;

		const target = cursor.clone();
		if (moveByWords) {
			for (let i = 0; i < amount; i++) {
				moveToWordBoundary(buffer, target, delta);
			}
		} else {
			target.shift(delta * amount);
		}

		this._applied = {
			amount: Math.abs(cursor.x - target.x),
			prevPosition,
			prevAttrs,
			rollForward: cursor.moveTo(target),
		};

		return this._applied.rollForward;
	}

	rollback(cursor: Cursor) {
		if (!this._applied) {
			return '';
		}

		return cursor.move(this._applied.prevPosition, cursor.y) + this._applied.prevAttrs;
	}

	rollForwards() {
		return ''; // does not need to rewrite
	}

	matches(input: StringReader) {
		if (!this._applied) {
			return MatchResult.Failure;
		}

		const direction = this._direction;
		const { amount, rollForward } = this._applied;

		// arg can be omitted to move one character. We don't eatGradually() here
		// or below moves that don't go as far as the cursor would be buffered
		// indefinitely
		if (input.eatStr(`${VT.Csi}${direction}`.repeat(amount))) {
			return MatchResult.Success;
		}

		// \b is the equivalent to moving one character back
		if (direction === CursorMoveDirection.Back) {
			if (input.eatStr(`\b`.repeat(amount))) {
				return MatchResult.Success;
			}
		}

		// check if the cursor position is set absolutely
		if (rollForward) {
			const r = input.eatGradually(rollForward);
			if (r !== MatchResult.Failure) {
				return r;
			}
		}

		// check for a relative move in the direction
		return input.eatGradually(`${VT.Csi}${amount}${direction}`);
	}
}

class PredictionStats {
	private readonly _stats: [latency: number, correct: boolean][] = [];
	private _index = 0;
	private readonly _addedAtTime = new WeakMap<IPrediction, number>();
	readonly events = mitt<{ change: undefined }>();

	/**
	 * Gets the percent (0-1) of predictions that were accurate.
	 */
	get accuracy() {
		let correctCount = 0;
		for (const [, correct] of this._stats) {
			if (correct) {
				correctCount++;
			}
		}

		return correctCount / (this._stats.length || 1);
	}

	/**
	 * Gets the number of recorded stats.
	 */
	get sampleSize() {
		return this._stats.length;
	}

	/**
	 * Gets latency stats of successful predictions.
	 */
	get latency() {
		const latencies = this._stats
			.filter(([, correct]) => correct)
			.map(([s]) => s)
			.sort((a, b) => a - b);

		return {
			count: latencies.length,
			min: latencies[0],
			median: latencies[Math.floor(latencies.length / 2)],
			max: latencies[latencies.length - 1],
		};
	}

	/**
	 * Gets the maximum observed latency.
	 */
	get maxLatency() {
		let max = -Infinity;
		for (const [latency, correct] of this._stats) {
			if (correct) {
				max = Math.max(latency, max);
			}
		}

		return max;
	}

	private readonly disposers: Array<() => void> = [];

	constructor(timeline: PredictionTimeline) {
		const added = (prediction: IPrediction) => this._addedAtTime.set(prediction, Date.now());

		const succeeded = this._pushStat.bind(this, true);
		const failed = this._pushStat.bind(this, false);
		timeline.events.on('added', added);
		timeline.events.on('succeeded', succeeded);
		timeline.events.on('failed', failed);
		this.disposers.push(
			() => timeline.events.off('added', added),
			() => timeline.events.off('succeeded', succeeded),
			() => timeline.events.off('failed', failed),
		);
	}

	dispose(): void {
		for (const off of this.disposers) off();
		this.events.all.clear();
	}

	private _pushStat(correct: boolean, prediction: IPrediction) {
		const started = this._addedAtTime.get(prediction);
		if (started === undefined) return;
		this._stats[this._index] = [Date.now() - started, correct];
		this._index = (this._index + 1) % StatsConstants.StatsBufferSize;
		this.events.emit('change', undefined);
	}
}

class PredictionTimeline {
	/**
	 * Expected queue of events. Only predictions for the lowest are
	 * written into the terminal.
	 */
	private _expected: { gen: number; p: IPrediction }[] = [];

	/**
	 * Current prediction generation.
	 */
	private _currentGen = 0;

	/**
	 * Current cursor position -- kept outside the buffer since it can be ahead
	 * if typing swiftly. The position of the cursor that the user is currently
	 * looking at on their screen (or will be looking at after all pending writes
	 * are flushed.)
	 */
	private _physicalCursor: Cursor | undefined;

	/**
	 * Cursor position taking into account all (possibly not-yet-applied)
	 * predictions. A new prediction inserted, if applied, will be applied at
	 * the position of the tentative cursor.
	 */
	private _tenativeCursor: Cursor | undefined;

	/**
	 * Previously sent data that was buffered and should be prepended to the
	 * next input.
	 */
	private _inputBuffer?: string;

	/**
	 * Whether predictions are echoed to the terminal. If false, predictions
	 * will still be computed internally for latency metrics, but input will
	 * never be adjusted.
	 */
	private _showPredictions = false;

	/**
	 * The last successfully-made prediction.
	 */
	private _lookBehind?: IPrediction;

	readonly events = mitt<{ added: IPrediction; failed: IPrediction; succeeded: IPrediction }>();

	private get _currentGenerationPredictions() {
		return this._expected.filter(({ gen }) => gen === this._expected[0]?.gen).map(({ p }) => p);
	}

	get isShowingPredictions() {
		return this._showPredictions;
	}

	get length() {
		return this._expected.length;
	}

	constructor(readonly terminal: Terminal) {}

	setShowPredictions(show: boolean) {
		if (show === this._showPredictions) {
			return;
		}

		this._showPredictions = show;

		const buffer = this._getActiveBuffer();
		if (!buffer) {
			return;
		}

		const toApply = this._currentGenerationPredictions;
		if (show) {
			this.clearCursor();
			this.terminal.write(toApply.map((p) => p.apply(buffer, this.physicalCursor(buffer))).join(''));
		} else {
			this.terminal.write(
				toApply
					.reverse()
					.map((p) => p.rollback(this.physicalCursor(buffer)))
					.join(''),
			);
		}
	}

	/**
	 * Undoes any predictions written and resets expectations.
	 */
	undoAllPredictions(): string {
		const buffer = this._getActiveBuffer();
		let output = '';
		if (this._showPredictions && buffer) {
			output = this._currentGenerationPredictions
				.reverse()
				.map((p) => p.rollback(this.physicalCursor(buffer)))
				.join('');
			if (output) output += attributesToSeq(readCurrentAttributes(this.terminal));
			output += this._inputBuffer ?? '';
		}
		this._inputBuffer = undefined;
		this._clearPredictionState();
		return output;
	}

	/**
	 * Should be called when input is incoming to the temrinal.
	 */
	beforeServerInput(input: string): string {
		const originalInput = input;
		if (this._inputBuffer) {
			input = this._inputBuffer + input;
			this._inputBuffer = undefined;
		}

		if (!this._expected.length) {
			this._clearPredictionState();
			return input;
		}

		const buffer = this._getActiveBuffer();
		if (!buffer) {
			this._clearPredictionState();
			return input;
		}

		let output = '';

		const reader = new StringReader(input);
		const startingGen = this._expected[0]?.gen;

		const emitPredictionOmitted = () => {
			const omit = reader.eatRe(PREDICTION_OMIT_RE);
			if (omit) {
				output += omit[0];
			}
		};

		ReadLoop: while (this._expected.length && reader.remaining > 0) {
			emitPredictionOmitted();
			// Cursor visibility/report frames contain no echo to match. In particular,
			// testing a backspace against EOF would incorrectly roll back every delete.
			if (reader.eof) break;
			if (reader.hasIncompleteControlSequence) {
				this._inputBuffer = reader.rest;
				reader.index = input.length;
				break;
			}

			const expected = this._expected[0];
			if (!expected) break;
			const { p: prediction, gen } = expected;
			const cursor = this.physicalCursor(buffer);
			const beforeTestReaderIndex = reader.index;
			switch (prediction.matches(reader, this._lookBehind)) {
				case MatchResult.Success: {
					// if the input character matches what the next prediction expected, undo
					// the prediction and write the real character out.
					const eaten = input.slice(beforeTestReaderIndex, reader.index);
					if (gen === startingGen) {
						output += prediction.rollForwards?.(cursor, eaten);
					} else {
						prediction.apply(buffer, this.physicalCursor(buffer)); // move cursor for additional apply
						output += eaten;
					}

					this.events.emit('succeeded', prediction);
					this._lookBehind = prediction;
					this._expected.shift();
					break;
				}
				case MatchResult.Buffer:
					// on a buffer, store the remaining data and completely read data
					// to be output as normal.
					this._inputBuffer = input.slice(beforeTestReaderIndex);
					reader.index = input.length;
					break ReadLoop;
				case MatchResult.Failure: {
					// on a failure, roll back all remaining items in this generation
					// and clear predictions, since they are no longer valid
					const rollback = this._expected.filter((p) => p.gen === startingGen).reverse();
					output += rollback.map(({ p }) => p.rollback(this.physicalCursor(buffer))).join('');
					if (rollback.length) {
						// reading the current style should generally be safe, since predictions
						// always restore the style if they modify it.
						output += attributesToSeq(readCurrentAttributes(this.terminal));
					}
					this._clearPredictionState();
					this.events.emit('failed', prediction);
					break ReadLoop;
				}
			}
		}

		emitPredictionOmitted();

		// Extra data (like the result of running a command) should cause us to
		// reset the cursor
		if (!reader.eof) {
			output += reader.rest;
			this._clearPredictionState();
		}

		// If we passed a generation boundary, apply the current generation's predictions
		if (this._expected.length && startingGen !== this._expected[0]?.gen) {
			for (const { p, gen } of this._expected) {
				if (gen !== this._expected[0]?.gen) {
					break;
				}

				output += p.apply(buffer, this.physicalCursor(buffer));
			}
		}

		if (!this._showPredictions) {
			return originalInput;
		}

		if (output.length === 0 || output === input) {
			return output;
		}

		if (this._physicalCursor) {
			output += this._physicalCursor.moveInstruction();
		}

		// Preserve the server's cursor visibility; never force DECTCEM on here.

		return output;
	}

	/**
	 * Clears any expected predictions and stored state. Should be called when
	 * the pty gives us something we don't recognize.
	 */
	revision = 0;

	private _clearPredictionState() {
		this.revision++;
		this._expected = [];
		this.clearCursor();
		this._lookBehind = undefined;
	}

	/**
	 * Appends a typeahead prediction.
	 */
	addPrediction(buffer: IBuffer, prediction: IPrediction) {
		this._expected.push({ gen: this._currentGen, p: prediction });
		this.events.emit('added', prediction);

		if (this._currentGen !== this._expected[0]?.gen) {
			prediction.apply(buffer, this.tentativeCursor(buffer));
			return false;
		}

		const text = prediction.apply(buffer, this.physicalCursor(buffer));
		this._tenativeCursor = undefined; // next read will get or clone the physical cursor

		if (this._showPredictions && text) {
			this.terminal.write(text);
		}

		return true;
	}

	/**
	 * Appends a prediction followed by a boundary. The predictions applied
	 * after this one will only be displayed after the give prediction matches
	 * pty output/
	 */
	addBoundary(): void;

	addBoundary(buffer: IBuffer, prediction: IPrediction): boolean;

	addBoundary(buffer?: IBuffer, prediction?: IPrediction) {
		let applied = false;
		if (buffer && prediction) {
			// We apply the prediction so that it's matched against, but wrapped
			// in a tentativeboundary so that it doesn't affect the physical cursor.
			// Then we apply it specifically to the tentative cursor.
			applied = this.addPrediction(buffer, new TentativeBoundary(prediction));
			prediction.apply(buffer, this.tentativeCursor(buffer));
		}
		this._currentGen++;
		return applied;
	}

	/**
	 * Peeks the last prediction written.
	 */
	peekEnd(): IPrediction | undefined {
		return this._expected[this._expected.length - 1]?.p;
	}

	/**
	 * Peeks the first pending prediction.
	 */
	peekStart(): IPrediction | undefined {
		return this._expected[0]?.p;
	}

	/**
	 * Current position of the cursor in the terminal.
	 */
	physicalCursor(buffer: IBuffer) {
		if (!this._physicalCursor) {
			this._physicalCursor = new Cursor(this.terminal.rows, this.terminal.cols, buffer);
		}

		return this._physicalCursor;
	}

	/**
	 * Cursor position if all predictions and boundaries that have been inserted
	 * so far turn out to be successfully predicted.
	 */
	tentativeCursor(buffer: IBuffer) {
		if (!this._tenativeCursor) {
			this._tenativeCursor = this.physicalCursor(buffer).clone();
		}

		return this._tenativeCursor;
	}

	clearCursor() {
		this._physicalCursor = undefined;
		this._tenativeCursor = undefined;
	}

	private _getActiveBuffer() {
		const buffer = this.terminal.buffer.active;
		return buffer.type === 'normal' ? buffer : undefined;
	}
}

/**
 * Gets the escape sequence args to restore state/appearance in the cell.
 */
const attributesToArgs = (cell: XtermAttributes) => {
	if (cell.isAttributeDefault()) {
		return [0];
	}

	const args = [0];
	if (cell.isBold()) {
		args.push(1);
	}
	if (cell.isDim()) {
		args.push(2);
	}
	if (cell.isItalic()) {
		args.push(3);
	}
	if (cell.isUnderline()) {
		args.push(4);
	}
	if (cell.isBlink()) {
		args.push(5);
	}
	if (cell.isInverse()) {
		args.push(7);
	}
	if (cell.isInvisible()) {
		args.push(8);
	}
	if (cell.isStrikethrough()) {
		args.push(9);
	}
	if (cell.isOverline()) {
		args.push(53);
	}

	if (cell.isFgRGB()) {
		args.push(38, 2, (cell.getFgColor() >>> 16) & 0xff, (cell.getFgColor() >>> 8) & 0xff, cell.getFgColor() & 0xff);
	}
	if (cell.isFgPalette()) {
		args.push(38, 5, cell.getFgColor());
	}
	if (cell.isFgDefault()) {
		args.push(39);
	}

	if (cell.isBgRGB()) {
		args.push(48, 2, (cell.getBgColor() >>> 16) & 0xff, (cell.getBgColor() >>> 8) & 0xff, cell.getBgColor() & 0xff);
	}
	if (cell.isBgPalette()) {
		args.push(48, 5, cell.getBgColor());
	}
	if (cell.isBgDefault()) {
		args.push(49);
	}

	return args;
};

/**
 * Gets the escape sequence to restore state/appearance in the cell.
 */
const attributesToSeq = (cell: XtermAttributes | undefined) =>
	cell ? `${VT.Csi}${attributesToArgs(cell).join(';')}m` : '';

const enum CharPredictState {
	Unknown,
	HasPendingChar,
	Validated,
}

/** VS Code prediction engine with a serialized xterm host instead of VS Code services. */
export class TerminalTypeAhead {
	private readonly timeline: PredictionTimeline;
	private readonly stats: PredictionStats;
	private lastRow?: { y: number; startingX: number; endingX: number; charState: CharPredictState };
	private readonly queue: Array<() => void> = [];
	private processing = false;
	private stopped = false;
	private epoch = 0;
	private title = '';
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly titleSubscription;

	constructor(private readonly terminal: Terminal) {
		this.timeline = new PredictionTimeline(terminal);
		this.stats = new PredictionStats(this.timeline);
		this.titleSubscription = terminal.onTitleChange((title) => {
			this.title = title;
		});
		this.timeline.events.on('succeeded', (prediction) => {
			if (
				this.lastRow?.charState === CharPredictState.HasPendingChar &&
				isTenativeCharacterPrediction(prediction) &&
				prediction.inner.appliedAt &&
				prediction.inner.appliedAt.pos.y + prediction.inner.appliedAt.pos.baseY === this.lastRow.y
			) {
				this.lastRow.charState = CharPredictState.Validated;
			}
		});
	}

	private enqueue(action: () => void): void {
		this.queue.push(action);
		this.pump();
	}

	private pump(): void {
		if (this.processing) return;
		const action = this.queue.shift();
		if (!action) return;
		this.processing = true;
		// Observe the parsed cursor and cells, including previous local writes.
		this.terminal.write('', () => {
			action();
			this.terminal.write('', () => {
				this.processing = false;
				this.pump();
			});
		});
	}

	private canPredict(): boolean {
		const modes = this.terminal.modes;
		return (
			this.terminal.buffer.active.type === 'normal' &&
			!modes.originMode &&
			!modes.insertMode &&
			modes.mouseTrackingMode === 'none' &&
			!/(?:^|[\s/])(vim?|nvim|nano|tmux|screen|less|more)(?:$|[\s:])/i.test(this.title) &&
			supportsPrediction(this.terminal)
		);
	}

	input(data: string): void {
		if (this.stopped) return;
		// Some keyboards deliver repeat deletion as one accepted input event.
		// Separate predictions so each rollback reads cells after the preceding erase.
		if (data.length > 1 && /^\x7f+$/.test(data)) {
			for (const char of data) this.input(char);
			return;
		}
		const epoch = this.epoch;
		this.enqueue(() => {
			if (this.stopped || epoch !== this.epoch) return;
			if (
				!this.canPredict() ||
				(data.length > 1 && !/^\x1b(?:\[?[0-9]*(?:;[35])?O?[DC]|[bf])$/.test(data)) ||
				/[^\x00-\x7f]/.test(data) ||
				(data.length === 1 && !/^[\x20-\x7e\x7f\r]$/.test(data))
			) {
				this.clear();
				return;
			}
			const pending = this.timeline.peekEnd();
			if (pending instanceof TentativeBoundary && pending.inner instanceof HardBoundary) return;
			if (
				/^[\x20-\x7e]$/.test(data) &&
				this.timeline.tentativeCursor(this.terminal.buffer.active).x >= this.terminal.cols - 1
			) {
				// A wrap is not predictable here, but older accepted characters must not
				// disappear just because the next key reached the edge. Let real echo settle them.
				this.timeline.addBoundary(this.terminal.buffer.active, new HardBoundary());
				this.deferClearing();
				return;
			}
			if (!this.timeline.length) {
				const latency = this.stats.latency.median;
				if (this.stats.sampleSize > StatsConstants.StatsMinSamplesToTurnOn && latency !== undefined) {
					if (this.stats.accuracy > StatsConstants.StatsMinAccuracyToTurnOn && latency >= 30)
						this.timeline.setShowPredictions(true);
					else if (latency < 15 || this.stats.accuracy <= StatsConstants.StatsMinAccuracyToTurnOn)
						this.timeline.setShowPredictions(false);
				}
			}
			this.predictInput(data);
		});
	}

	write(data: string, consumed?: () => void): void {
		this.enqueue(() => {
			const revision = this.timeline.revision;
			const output = data ? this.timeline.beforeServerInput(data) : '';
			if (this.timeline.revision !== revision) this.lastRow = undefined;
			this.terminal.write(output, consumed);
			this.deferClearing();
		});
	}

	private clear(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
		this.terminal.write(this.timeline.undoAllPredictions());
		this.lastRow = undefined;
	}

	reset(): Promise<void> {
		this.epoch++;
		return new Promise((resolve) =>
			this.enqueue(() => {
				this.clear();
				this.terminal.write('', resolve);
			}),
		);
	}

	/** Queue local display resets beside remote writes, never in front of older output. */
	barrier(action: () => void): void {
		this.epoch++;
		this.enqueue(() => {
			this.clear();
			this.terminal.write('', action);
		});
	}

	stop(): void {
		this.stopped = true;
		clearTimeout(this.timer);
		this.titleSubscription.dispose();
		this.stats.dispose();
	}

	private deferClearing(): void {
		clearTimeout(this.timer);
		if (!this.timeline.length || this.timeline.peekStart()?.clearAfterTimeout === false || this.stopped) return;
		this.timer = setTimeout(
			() => {
				void this.reset();
			},
			// Allow the first real sample on very high RTT links before using learned latency.
			Math.max(this.stats.sampleSize ? 500 : 5000, this.stats.maxLatency * 1.5),
		);
	}

	private predictInput(data: string): void {
		if (this.timeline.terminal.buffer.active.type !== 'normal') {
			return;
		}

		const terminal = this.timeline.terminal;
		const buffer = terminal.buffer.active;

		// Detect programs like git log/less that use the normal buffer but don't
		// take input by deafult (fixes #109541)
		if (buffer.cursorX === 1 && buffer.cursorY === terminal.rows - 1) {
			if (
				buffer
					.getLine(buffer.cursorY + buffer.baseY)
					?.getCell(0)
					?.getChars() === ':'
			) {
				return;
			}
		}

		// the following code guards the terminal prompt to avoid being able to
		// arrow or backspace-into the prompt. Record the lowest X value at which
		// the user gave input, and mark all additions before that as tentative.
		const actualY = buffer.baseY + buffer.cursorY;
		if (actualY !== this.lastRow?.y) {
			this.lastRow = {
				y: actualY,
				startingX: buffer.cursorX,
				endingX: buffer.cursorX,
				charState: CharPredictState.Unknown,
			};
		} else {
			this.lastRow.startingX = Math.min(this.lastRow.startingX, buffer.cursorX);
			this.lastRow.endingX = Math.max(this.lastRow.endingX, this.timeline.physicalCursor(buffer).x);
		}

		const row = this.lastRow;

		const addLeftNavigating = (p: IPrediction) =>
			this.timeline.tentativeCursor(buffer).x <= row.startingX
				? this.timeline.addBoundary(buffer, p)
				: this.timeline.addPrediction(buffer, p);

		const addRightNavigating = (p: IPrediction) =>
			this.timeline.tentativeCursor(buffer).x >= row.endingX - 1
				? this.timeline.addBoundary(buffer, p)
				: this.timeline.addPrediction(buffer, p);

		/** @see https://github.com/xtermjs/xterm.js/blob/1913e9512c048e3cf56bb5f5df51bfff6899c184/src/common/input/Keyboard.ts */
		const reader = new StringReader(data);
		while (reader.remaining > 0) {
			if (reader.eatCharCode(127)) {
				// backspace
				const previous = this.timeline.peekEnd();
				if (previous && previous instanceof CharacterPrediction) {
					this.timeline.addBoundary();
				}

				if (this.timeline.tentativeCursor(buffer).x <= row.startingX) {
					this.timeline.addBoundary(buffer, new BackspacePrediction(this.timeline.terminal));
				} else {
					// Backspace decrements our ability to go right.
					row.endingX--;
					this.timeline.addPrediction(buffer, new BackspacePrediction(this.timeline.terminal));
				}

				continue;
			}

			if (reader.eatCharCode(32, 127)) {
				// alphanum
				const char = data.charAt(reader.index - 1);
				const prediction = new CharacterPrediction(char);
				if (row.charState === CharPredictState.Unknown) {
					this.timeline.addBoundary(buffer, prediction);
					row.charState = CharPredictState.HasPendingChar;
				} else {
					this.timeline.addPrediction(buffer, prediction);
				}

				continue;
			}

			const cursorMv = reader.eatRe(CSI_MOVE_RE);
			if (cursorMv) {
				const direction = cursorMv[3] === 'D' ? CursorMoveDirection.Back : CursorMoveDirection.Forwards;
				const amount = Number(cursorMv[1]) || 1;
				const x = this.timeline.tentativeCursor(buffer).x;
				const target = direction === CursorMoveDirection.Back ? x - amount : x + amount;
				if (!Number.isSafeInteger(amount) || target < row.startingX || target >= terminal.cols) {
					this.clear();
					break;
				}
				const p = new CursorMovePrediction(direction, !!cursorMv[2], amount);
				if (direction === CursorMoveDirection.Back) {
					addLeftNavigating(p);
				} else {
					addRightNavigating(p);
				}
				continue;
			}

			if (reader.eatStr(`${VT.Esc}f`)) {
				addRightNavigating(new CursorMovePrediction(CursorMoveDirection.Forwards, true, 1));
				continue;
			}

			if (reader.eatStr(`${VT.Esc}b`)) {
				addLeftNavigating(new CursorMovePrediction(CursorMoveDirection.Back, true, 1));
				continue;
			}

			if (reader.eatChar('\r') && buffer.cursorY < terminal.rows - 1) {
				this.timeline.addBoundary(buffer, new NewlinePrediction());
				this.lastRow = undefined;
				continue;
			}

			// something else
			this.timeline.addBoundary(buffer, new HardBoundary());
			break;
		}

		this.deferClearing();
	}
}
