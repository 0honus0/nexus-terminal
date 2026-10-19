import type { ProcessDiagnosticSource, ProcessDiagnostic } from '../process-diagnostic.js';

export class NodeProcessDiagnostic implements ProcessDiagnosticSource {
	collect(): ProcessDiagnostic {
		const memory = process.memoryUsage();
		return {
			uptimeSeconds: Math.floor(process.uptime()),
			residentBytes: memory.rss,
			heapUsedBytes: memory.heapUsed,
			runtimeVersion: process.version,
		};
	}
}
