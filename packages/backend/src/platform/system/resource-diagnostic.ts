import type {
	DiagnosticModuleId,
	DiagnosticResourceName,
	DiagnosticResourceUnit,
	DiagnosticResourceStatus,
} from '@nexus-terminal/shared/system/diagnostics/values';

export interface ResourceMetric {
	name: DiagnosticResourceName;
	unit: DiagnosticResourceUnit;
	value: number;
}

export interface ResourceCollector {
	id: DiagnosticModuleId;
	collect(): readonly ResourceMetric[] | Promise<readonly ResourceMetric[]>;
}

export interface ModuleResourceDiagnostic {
	id: DiagnosticModuleId;
	status: DiagnosticResourceStatus;
	metrics: ResourceMetric[];
}
