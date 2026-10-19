import type { ObservationErrorCode } from '@nexus-terminal/shared/remote/monitoring/values';
import type { DockerAction } from '@nexus-terminal/shared/remote/docker/values';

export type ObservationDockerAction = DockerAction;

export class ObservationFailure extends Error {
	constructor(
		readonly code: ObservationErrorCode,
		options?: ErrorOptions,
	) {
		super(code, options);
	}
}

export interface ObservationSample {
	cpuPercent?: number;
	memPercent?: number;
	memUsed?: number;
	memTotal?: number;
	swapPercent?: number;
	swapUsed?: number;
	swapTotal?: number;
	diskPercent?: number;
	diskUsed?: number;
	diskTotal?: number;
	cpuModel?: string;
	netRxRate?: number;
	netTxRate?: number;
	netInterface?: string;
	osName?: string;
	loadAvg?: number[];
	timestamp: number;
}

interface ObservedSshResourceMetadata {
	key: string;
	connectionId: number;
	name: string;
	username: string;
	host: string;
	port: number;
	checkedAt: number;
}

export type ObservedSshResource = ObservedSshResourceMetadata &
	({ status: ObservationSample; error?: never } | { error: ObservationErrorCode; status?: never });

export interface ObservedDockerPort {
	ip?: string;
	privatePort: number;
	publicPort?: number;
	protocol: string;
}

export interface ObservedDockerStats {
	id: string;
	name: string;
	cpuPercent: string;
	memoryUsage: string;
	memoryPercent: string;
	networkIO: string;
	blockIO: string;
	processes: string;
}

export interface ObservedDockerContainer {
	id: string;
	names: string[];
	image: string;
	imageId: string;
	command: string;
	created: number | string;
	state: string;
	status: string;
	ports: ObservedDockerPort[];
	labels: string;
	stats: ObservedDockerStats | null;
}

export interface ObservedDockerStatus {
	available: boolean;
	containers: ObservedDockerContainer[];
}

export interface ObservationTarget {
	id: number;
	name: string;
	host: string;
	port: number;
	username: string;
	fingerprint: string | null;
	revision: number;
}

export interface ObservationScope {
	targetId: number;
	fingerprint: string;
	signal: AbortSignal;
	validate(): Promise<void>;
}

export interface WorkspaceObservationOwner {
	workspaceId: string;
	attachmentId: string;
	token: string | null;
}

export type ObservationStatusEvent =
	{ kind: 'sample'; value: ObservationSample } | { kind: 'error'; code: ObservationErrorCode };
