import type { ComputedRef, Ref } from 'vue';
import type { ObservationErrorCode } from '@nexus-terminal/shared/remote/monitoring/values';
import type { SystemStatusErrorCode } from '@nexus-terminal/shared/system/status/values';
import type { HttpRequestFailureCode } from '@/client/http/request-failure';

export type ResourceFailureCode = ObservationErrorCode | SystemStatusErrorCode | HttpRequestFailureCode;

export class ResourceFailure extends Error {
	constructor(
		readonly code: ResourceFailureCode,
		options?: ErrorOptions,
	) {
		super(code, options);
		this.name = 'ResourceFailure';
	}
}

export interface ResourceMetrics {
	cpuPercent?: number;
	memPercent?: number;
	memUsed?: number;
	memTotal?: number;
	diskPercent?: number;
	diskUsed?: number;
	diskTotal?: number;
}

export interface LocalResourceStatus {
	cpuPercent: number;
	memPercent: number;
	memUsed: number;
	memTotal: number;
	diskPercent?: number;
	diskUsed?: number;
	diskTotal?: number;
	checkedAt: number;
}

export interface SshResourceTarget {
	id: number;
	name: string | null;
	username: string;
	host: string;
	port: number;
}

interface ResourceIdentity {
	key: string;
	connectionId: number;
	name: string;
	username: string;
	host: string;
	port: number;
}

export type SshResource = ResourceIdentity &
	(
		| { state: 'waiting'; checkedAt: null; status?: never; error?: never }
		| {
				state: 'ready';
				checkedAt: number;
				status: ResourceMetrics;
				error?: never;
				refreshError?: ResourceFailureCode;
		  }
		| { state: 'failed'; checkedAt: number | null; status?: never; error: ResourceFailureCode }
	);

export interface SystemOverviewController {
	local: Readonly<Ref<LocalResourceStatus | null>>;
	remote: Readonly<Ref<SshResource[]>>;
	loading: ComputedRef<boolean>;
	localLoading: Readonly<Ref<boolean>>;
	remoteLoading: Readonly<Ref<boolean>>;
	localError: Readonly<Ref<ResourceFailureCode | null>>;
	remoteError: Readonly<Ref<ResourceFailureCode | null>>;
	loadLocal(): Promise<void>;
	loadRemote(targets: () => Promise<SshResourceTarget[]>): Promise<void>;
	stopLocal(): void;
	stopRemote(): void;
	activate(): void;
	deactivate(): void;
	dispose(): void;
}
