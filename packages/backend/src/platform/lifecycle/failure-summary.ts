/** Bounded private diagnostic samples; discarded samples still count as failures. */
export class FailureSummary {
	private readonly samples: unknown[] = [];
	private total = 0;

	record(error: unknown): void {
		this.total = Math.min(Number.MAX_SAFE_INTEGER, this.total + 1);
		if (this.samples.length === 16) {
			this.samples.shift();
		}
		this.samples.push(error);
	}

	errors(): unknown[] {
		const errors = [...this.samples];
		if (this.total > this.samples.length) {
			errors.push(new Error('Additional cleanup failures: ' + (this.total - this.samples.length)));
		}
		return errors;
	}
}
