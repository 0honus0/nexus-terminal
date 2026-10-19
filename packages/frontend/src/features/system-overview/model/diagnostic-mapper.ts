import type { HostDiagnosticView } from '@nexus-terminal/shared/system/diagnostics/model';
import type { HostDiagnostics } from './diagnostic-types';

export function fromDiagnostics(value: HostDiagnosticView): HostDiagnostics {
	return {
		collectedAt: value.collectedAt,
		process: {
			uptimeSeconds: value.process.uptimeSeconds,
			residentBytes: value.process.residentBytes,
			heapUsedBytes: value.process.heapUsedBytes,
			runtimeVersion: value.process.runtimeVersion,
		},
		database: { available: value.database.available, schemaVersion: value.database.schemaVersion },
	};
}
