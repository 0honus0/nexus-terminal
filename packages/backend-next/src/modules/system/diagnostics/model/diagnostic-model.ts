import type { ProcessDiagnosticSource } from '../../../../platform/system/process-diagnostic.js';
import type { DiagnosticStorage } from '../storage/diagnostic-storage.js';
import type { HostDiagnostic } from './diagnostic-types.js';

export class DiagnosticModel {
	constructor(
		private readonly process: ProcessDiagnosticSource,
		private readonly storage: DiagnosticStorage,
	) {}

	async collect(): Promise<HostDiagnostic> {
		const value = this.process.collect();
		let schemaVersion: number | null = null;
		try {
			schemaVersion = await this.storage.schemaVersion();
		} catch {
			schemaVersion = null;
		}
		return {
			collectedAt: Date.now(),
			process: {
				uptimeSeconds: value.uptimeSeconds,
				residentBytes: value.residentBytes,
				heapUsedBytes: value.heapUsedBytes,
				runtimeVersion: value.runtimeVersion,
			},
			database: { available: schemaVersion !== null, schemaVersion },
		};
	}
}
