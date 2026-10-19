import type { ComputedRef } from 'vue';
import type { ProxyType } from '@nexus-terminal/shared/targets/proxies/values';
import type { TargetProxyInput } from '@nexus-terminal/shared/targets/proxies/http';

export interface ProxySummary {
	id: number;
	name: string;
	type: ProxyType;
	host: string;
	port: number;
	username: string | null;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface ProxyDraft {
	name: string;
	type: ProxyType;
	host: string;
	port: number;
	username: string;
	password: string;
	clearPassword: boolean;
}

export interface ProxiesController {
	proxies: ComputedRef<ProxySummary[]>;
	loaded: ComputedRef<boolean>;
	busy: ComputedRef<boolean>;
	needsRefresh: ComputedRef<boolean>;
	load(force?: boolean): Promise<ProxySummary[]>;
	create(input: TargetProxyInput, signal?: AbortSignal): Promise<ProxySummary>;
	update(snapshot: ProxySummary, input: TargetProxyInput, signal?: AbortSignal): Promise<ProxySummary>;
	remove(id: number, signal?: AbortSignal): Promise<void>;
}
