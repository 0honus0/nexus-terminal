/** Append-only UTF-8 records. Tags are caller-owned safe nonnegative integers. */
export interface TextLogRecord {
	tag: number;
	text: string;
}

export interface TextLogPage {
	records: TextLogRecord[];
	nextOffset: number;
	totalBytes: number;
}

export interface TextLogWriter {
	append(record: TextLogRecord, signal: AbortSignal, blocked: (waiting: boolean) => void): Promise<void>;
	flush(signal: AbortSignal, blocked: (waiting: boolean) => void): Promise<void>;
	close(): Promise<void>;
}

export interface TextLogStore {
	create(key: string): Promise<TextLogWriter>;
	read(key: string, offset: number, maxBytes: number): Promise<TextLogPage>;
	keys(): AsyncIterable<string>;
	remove(key: string): Promise<void>;
}

export class TextLogFailure extends Error {
	constructor(
		readonly reason: 'not_found' | 'invalid_offset' | 'unavailable' | 'cleanup_failed',
		options?: ErrorOptions,
	) {
		super('Text log ' + reason, options);
		this.name = 'TextLogFailure';
	}
}
