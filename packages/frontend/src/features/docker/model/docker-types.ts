import type { ComputedRef, Ref } from 'vue';
import type { DockerAction } from '@nexus-terminal/shared/remote/docker/values';
import type { WorkspaceErrorCode } from '@nexus-terminal/shared/remote/workspace/values';

export type { DockerAction } from '@nexus-terminal/shared/remote/docker/values';

export interface DockerPortBinding {
	ip?: string;
	privatePort: number;
	publicPort?: number;
	type: string;
}

export interface DockerStats {
	id: string;
	name: string;
	cpuPercent: string;
	memoryUsage: string;
	memoryPercent: string;
	networkIo: string;
	blockIo: string;
	pids: string;
}

export interface DockerContainer {
	id: string;
	names: string[];
	image: string;
	imageId: string;
	command: string;
	created: number | string;
	state: string;
	status: string;
	ports: DockerPortBinding[];
	labels: Record<string, string> | string;
	stats?: DockerStats | null;
}

export interface DockerStatus {
	available: boolean;
	containers: DockerContainer[];
}

export type DockerFailureCode = WorkspaceErrorCode | 'protocol_failure';

export class DockerFailure extends Error {
	constructor(
		readonly code: DockerFailureCode,
		readonly outcome: 'not_dispatched' | 'confirmed' | 'unknown',
		options?: ErrorOptions,
	) {
		super(code, options);
		this.name = 'DockerFailure';
	}
}

export interface DockerSessionController {
	available: Readonly<Ref<boolean>>;
	containers: Readonly<Ref<DockerContainer[]>>;
	loading: Readonly<Ref<boolean>>;
	commandPending: Readonly<Ref<boolean>>;
	commandBlocked: Readonly<Ref<boolean>>;
	reconcile(): Promise<void>;
	error: Readonly<Ref<DockerFailureCode | null>>;
	expandedContainerIds: ComputedRef<ReadonlySet<string>>;
	activate(): void;
	deactivate(): void;
	setIntervalSeconds(seconds: number): void;
	setDefaultExpand(expanded: boolean): void;
	workspaceConnected(): void;
	workspaceDisconnected(): void;
	refresh(force?: boolean): Promise<void>;
	command(containerId: string, action: DockerAction): Promise<void>;
	toggleExpand(containerId: string): void;
	dispose(): void;
}
