import type { FileListItem } from '../../types/sftp.types';
import type { FilePreviewProvider } from './types';

const providers: FilePreviewProvider[] = [];

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
