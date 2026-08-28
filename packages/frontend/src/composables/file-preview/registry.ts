import type { FileListItem } from '../../types/sftp.types';
import type { FilePreviewProvider } from './types';

const providers: FilePreviewProvider[] = [];
const preloadPromises = new Map<string, Promise<void>>();

const sortProviders = () => {
  providers.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
};

export function registerFilePreviewProvider(provider: FilePreviewProvider) {
  const existingIndex = providers.findIndex((registered) => registered.id === provider.id);
  if (existingIndex >= 0) {
    providers.splice(existingIndex, 1, provider);
  } else {
    providers.push(provider);
  }
  sortProviders();
}

export function resolveFilePreviewProvider(file: FileListItem): FilePreviewProvider | undefined {
  return providers.find((provider) => provider.canPreview(file));
}

export function preloadFilePreviewProvider(file: FileListItem): Promise<void> | undefined {
  const provider = resolveFilePreviewProvider(file);
  if (!provider?.preload) return undefined;

  const existing = preloadPromises.get(provider.id);
  if (existing) return existing;

  const preload = Promise.resolve(provider.preload()).catch((error) => {
    preloadPromises.delete(provider.id);
    console.debug(`[FilePreview] Failed preloading provider ${provider.id}; open will retry normally.`, error);
  });
  preloadPromises.set(provider.id, preload);
  return preload;
}
