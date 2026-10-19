import { inject, provide, type Component, type ComputedRef, type InjectionKey } from 'vue';
import type { ConnectionSummary } from '@/features/connections/public';
import type { TagSummary } from '@/features/tags/public';
import type { ProxySummary } from '@/features/proxies/public';
import type { SshKeySummary } from '@/features/ssh-keys/public';
import type { TerminalViewport } from '@/features/terminal/public';

export interface RuntimeAuthCapability {
	userId: ComputedRef<number | null>;
	authenticated: ComputedRef<boolean>;
}

export interface RuntimeConnectionsCapability {
	items: ComputedRef<ConnectionSummary[]>;
	loaded: ComputedRef<boolean>;
	load(force?: boolean): Promise<ConnectionSummary[]>;
	revalidate(maxAgeMs?: number): Promise<ConnectionSummary[]>;
}

export interface RuntimeTagsCapability {
	items: ComputedRef<TagSummary[]>;
	load(force?: boolean): Promise<TagSummary[]>;
	revalidate(maxAgeMs?: number): Promise<TagSummary[]>;
	ensure(names: string[]): Promise<TagSummary[]>;
	picker: Component;
}

export interface RuntimeProxiesCapability {
	items: ComputedRef<ProxySummary[]>;
	load(force?: boolean): Promise<ProxySummary[]>;
}

export interface RuntimeSshKeysCapability {
	items: ComputedRef<SshKeySummary[]>;
	load(force?: boolean): Promise<SshKeySummary[]>;
	selector: Component;
}

export interface RuntimeTerminalOutput {
	data: string | Uint8Array;
}

export interface RuntimeTerminalChannel {
	sendInput(data: string): void | Promise<void>;
	resize(viewport: TerminalViewport): void | Promise<void>;
	onOutput(handler: (output: RuntimeTerminalOutput) => void): () => void;
	onClose(handler: (reason?: string) => void): () => void;
	onError(handler: (message: string) => void): () => void;
}

export interface RuntimeFeatureCapabilities {
	auth: RuntimeAuthCapability;
	connections: RuntimeConnectionsCapability;
	tags: RuntimeTagsCapability;
	proxies: RuntimeProxiesCapability;
	sshKeys: RuntimeSshKeysCapability;
	remoteDesktop: {
		open(connection: Pick<ConnectionSummary, 'id' | 'name' | 'type'>): void;
	};
	terminal: {
		loadView(): Promise<{ default: Component }>;
	};
}

const runtimeFeatureCapabilitiesKey: InjectionKey<RuntimeFeatureCapabilities> = Symbol('runtime-feature-capabilities');

export const provideRuntimeFeatureCapabilities = (capabilities: RuntimeFeatureCapabilities): void => {
	provide(runtimeFeatureCapabilitiesKey, capabilities);
};

export const useRuntimeFeatureCapabilities = (): RuntimeFeatureCapabilities => {
	const capabilities = inject(runtimeFeatureCapabilitiesKey);
	if (!capabilities)
		throw new Error('Runtime feature capabilities were not provided by the application composition root');
	return capabilities;
};

export type { ConnectionSummary, TerminalViewport };
