interface DurationTotals {
	count: number;
	milliseconds: number;
	maximumMilliseconds: number;
}

/** Constant-space measurements contain no SQL, parameters or application identities. */
export class SqliteStatistics {
	private readonly waiting: DurationTotals = { count: 0, milliseconds: 0, maximumMilliseconds: 0 };
	private readonly execution: DurationTotals = { count: 0, milliseconds: 0, maximumMilliseconds: 0 };
	private readonly commit: DurationTotals = { count: 0, milliseconds: 0, maximumMilliseconds: 0 };

	record(kind: 'waiting' | 'execution' | 'commit', milliseconds: number): void {
		const value = this[kind];
		value.count += 1;
		value.milliseconds += milliseconds;
		value.maximumMilliseconds = Math.max(value.maximumMilliseconds, milliseconds);
	}

	read(): { waiting: DurationTotals; execution: DurationTotals; commit: DurationTotals } {
		const copy = (value: DurationTotals): DurationTotals => ({
			count: value.count,
			milliseconds: Math.round(value.milliseconds),
			maximumMilliseconds: Math.round(value.maximumMilliseconds),
		});

		return { waiting: copy(this.waiting), execution: copy(this.execution), commit: copy(this.commit) };
	}
}
