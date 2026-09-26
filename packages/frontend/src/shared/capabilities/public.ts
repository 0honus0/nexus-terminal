import { inject, provide, type Component, type ComputedRef, type InjectionKey } from 'vue';
import type { ConnectionDto, ConnectionTagDto, ProxyDto, SshKeySummaryDto } from '@nexus-terminal/protocol/connections';
import type { WorkspaceTerminalViewportDto } from '@nexus-terminal/protocol/workspace';

export interface RuntimeAuthCapability {
  userId: ComputedRef<number | null>;
  authenticated: ComputedRef<boolean>;
}

export interface RuntimeConnectionsCapability {
  items: ComputedRef<ConnectionDto[]>;
  loaded: ComputedRef<boolean>;
  load(force?: boolean): Promise<ConnectionDto[]>;
  revalidate(maxAgeMs?: number): Promise<ConnectionDto[]>;
}

export interface RuntimeTagsCapability {
  items: ComputedRef<ConnectionTagDto[]>;
  load(force?: boolean): Promise<ConnectionTagDto[]>;
  revalidate(maxAgeMs?: number): Promise<ConnectionTagDto[]>;
  ensure(names: string[]): Promise<ConnectionTagDto[]>;
  picker: Component;
}

export interface RuntimeProxiesCapability {
  items: ComputedRef<ProxyDto[]>;
  load(force?: boolean): Promise<ProxyDto[]>;
}

export interface RuntimeSshKeysCapability {
  items: ComputedRef<SshKeySummaryDto[]>;
  load(force?: boolean): Promise<SshKeySummaryDto[]>;
  selector: Component;
}

export interface RuntimeTerminalOutput {
  data: string | Uint8Array;
}

export interface RuntimeTerminalChannel {
  sendInput(data: string): void | Promise<void>;
  resize(viewport: WorkspaceTerminalViewportDto): void | Promise<void>;
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
    open(connection: Pick<ConnectionDto, 'id' | 'name' | 'type'>): void;
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

export type { ConnectionDto, WorkspaceTerminalViewportDto };
