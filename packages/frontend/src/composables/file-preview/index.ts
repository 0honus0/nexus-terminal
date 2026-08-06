import { registerFilePreviewProvider } from './registry';
import { imagePreviewProvider } from './providers/imagePreviewProvider';

let initialized = false;

/**
 * Register all built-in file preview providers once.
 */
export function initFilePreviewProviders() {
  if (initialized) return;

  registerFilePreviewProvider(imagePreviewProvider);
  initialized = true;
}
