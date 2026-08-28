import type { ComputedRef, InjectionKey } from 'vue';

export interface FilePreviewTabDescriptor {
  id: string;
  filename: string;
  filePath: string;
}

export interface FilePreviewTabsContext {
  tabs: ComputedRef<FilePreviewTabDescriptor[]>;
  activeTabId: ComputedRef<string | null>;
  refreshingTabIds: ComputedRef<ReadonlySet<string>>;
  activate(tabId: string): void;
  close(tabId: string): void;
  refresh(tabId: string): Promise<void>;
  hide(): void;
  closeWorkspace(): void;
}

export const filePreviewTabsContextKey: InjectionKey<FilePreviewTabsContext> = Symbol('filePreviewTabsContext');
