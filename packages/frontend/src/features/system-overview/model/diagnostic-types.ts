import type { HostDiagnosticErrorCode } from '@nexus-terminal/shared/system/diagnostics/values';
import type { HttpRequestFailureCode } from '@/client/http/request-failure';

export interface HostDiagnostics {
	collectedAt: number;
	process: { uptimeSeconds: number; residentBytes: number; heapUsedBytes: number; runtimeVersion: string };
	database: { available: boolean; schemaVersion: number | null };
}

export class HostDiagnosticFailure extends Error {
	constructor(
		readonly code: HostDiagnosticErrorCode | HttpRequestFailureCode,
		options?: ErrorOptions,
	) {
		super('Host diagnostic read failed', options);
		this.name = 'HostDiagnosticFailure';
	}
}
