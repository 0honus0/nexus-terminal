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
			heapTotalBytes: value.process.heapTotalBytes,
			externalBytes: value.process.externalBytes,
			arrayBufferBytes: value.process.arrayBufferBytes,
			cpuUserSeconds: value.process.cpuUserSeconds,
			cpuSystemSeconds: value.process.cpuSystemSeconds,
			gcCount: value.process.gcCount,
			gcDurationSeconds: value.process.gcDurationSeconds,
		},
		modules: value.modules.map((module) => ({
			id: module.id,
			status: module.status,
			metrics: module.metrics.map((metric) => ({ name: metric.name, unit: metric.unit, value: metric.value })),
		})),
		database: { available: value.database.available, schemaVersion: value.database.schemaVersion },
	};
}
