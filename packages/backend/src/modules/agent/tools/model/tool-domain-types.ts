import type { AgentArtifactStatus } from '@nexus-terminal/shared/agent/artifacts/values';
import type { AgentRunFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type {
	DiagnosticModuleId,
	DiagnosticResourceName,
	DiagnosticResourceUnit,
	DiagnosticResourceStatus,
} from '@nexus-terminal/shared/system/diagnostics/values';

export interface ToolArtifactCreated {
	id: string;
	version: number;
	status: AgentArtifactStatus;
	sizeBytes: number;
	sha256: string | null;
}

export interface ToolArtifactPresented {
	id: string;
	name: string;
	sizeBytes: number;
}

export interface ToolArtifactPage {
	id: string;
	sha256: string;
	sizeBytes: number;
	offset: number;
	nextOffset: number | null;
	encoding: 'base64' | 'utf8';
	base64: string | null;
	text: string | null;
}

export interface ToolProjectValue {
	binding: { connectionId: number; directory: string } | null;
}

export interface ToolPathSnapshot {
	path: string;
	kind: 'file' | 'directory';
	fingerprint: string;
	fileCount: number;
	directoryCount: number;
	bytes: number;
}

export interface ToolDockerInspection {
	containerId: string;
	state: string;
	image: string;
	fingerprint: string;
}

export interface ToolDiagnosticsValue {
	generatedAt: number;
	cpuPercent: number | null;
	memUsedBytes: number | null;
	memTotalBytes: number | null;
	diskUsedBytes: number | null;
	diskTotalBytes: number | null;
	loadAverage: number[];
}

export interface ToolHostDiagnosticsValue {
	collectedAt: number;
	process: {
		uptimeSeconds: number;
		residentBytes: number;
		heapUsedBytes: number;
		runtimeVersion: string;
		heapTotalBytes: number;
		externalBytes: number;
		arrayBufferBytes: number;
		cpuUserSeconds: number;
		cpuSystemSeconds: number;
		gcCount: number;
		gcDurationSeconds: number;
	};
	modules: {
		id: DiagnosticModuleId;
		status: DiagnosticResourceStatus;
		metrics: { name: DiagnosticResourceName; unit: DiagnosticResourceUnit; value: number }[];
	}[];
	database: { available: boolean; schemaVersion: number | null };
}

export interface ToolDeliveredValue {
	id: string;
	name: string;
	sizeBytes: number;
	sha256: string | null;
}

export type ToolDeliveryItem =
	| { index: number; status: 'completed'; value: ToolDeliveredValue }
	| { index: number; status: 'failed' | 'unknown'; failureCode: AgentRunFailureCode }
	| { index: number; status: 'not_started' };

export interface ToolDeliveryValue {
	items: ToolDeliveryItem[];
}
