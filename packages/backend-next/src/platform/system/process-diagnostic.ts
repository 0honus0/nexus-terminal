export interface ProcessDiagnostic {
	uptimeSeconds: number;
	residentBytes: number;
	heapUsedBytes: number;
	runtimeVersion: string;
}

export interface ProcessDiagnosticSource {
	collect(): ProcessDiagnostic;
}
