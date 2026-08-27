import { registerFilePreviewProvider } from './registry';
import { imagePreviewProvider } from './providers/imagePreviewProvider';
import { markdownPreviewProvider } from './providers/markdownPreviewProvider';
import { pdfPreviewProvider } from './providers/pdfPreviewProvider';
import { spreadsheetPreviewProvider } from './providers/spreadsheetPreviewProvider';

let initialized = false;

/**
 * Register all built-in file preview providers once.
 */
export function initFilePreviewProviders() {
  if (initialized) return;

  registerFilePreviewProvider(imagePreviewProvider);
  registerFilePreviewProvider(markdownPreviewProvider);
  registerFilePreviewProvider(pdfPreviewProvider);
  registerFilePreviewProvider(spreadsheetPreviewProvider);
  initialized = true;
}
