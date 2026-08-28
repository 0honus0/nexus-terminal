import type { ComputedRef, InjectionKey } from 'vue';

export interface FilePreviewTabDescriptor {
  id: string;
  filename: string;
  filePath: string;
}

export interface FilePreviewTabsContext {
  tabs: ComputedRef<FilePreviewTabDescriptor[]>;
  activeTabId: ComputedRef<string | null>;
  activate(tabId: string): void;
  close(tabId: string): void;
  hide(): void;
}

export const filePreviewTabsContextKey: InjectionKey<FilePreviewTabsContext> = Symbol('filePreviewTabsContext');
