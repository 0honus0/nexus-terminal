import { registerFilePreviewProvider } from './registry';
import { imagePreviewProvider } from './providers/imagePreviewProvider';
import { markdownPreviewProvider } from './providers/markdownPreviewProvider';
import { spreadsheetPreviewProvider } from './providers/spreadsheetPreviewProvider';

let initialized = false;

/**
 * Register all built-in file preview providers once.
 */
export function initFilePreviewProviders() {
  if (initialized) return;

  registerFilePreviewProvider(imagePreviewProvider);
  registerFilePreviewProvider(markdownPreviewProvider);
  registerFilePreviewProvider(spreadsheetPreviewProvider);
  initialized = true;
}
