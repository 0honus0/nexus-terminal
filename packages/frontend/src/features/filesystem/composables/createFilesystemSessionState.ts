import { watch } from 'vue';
import type { FilesystemChannel } from '../ports/filesystem-channel';
import { useFilesystemBrowser, type FilesystemBrowserController } from './useFilesystemBrowser';
import { useFilesystemCatalog } from './useFilesystemCatalog';

export interface FilesystemSessionState {
  browser: FilesystemBrowserController;
  ensureLoaded(): Promise<void>;
  dispose(): void;
}

export function createFilesystemSessionState(channel: FilesystemChannel, initialPath = '.'): FilesystemSessionState {
  const browser = useFilesystemBrowser(channel, initialPath.startsWith('/') ? initialPath : '/');
  const catalog = useFilesystemCatalog();
  let initialRecorded = false;
  let disposed = false;

  const recordPath = (path: string) => {
    if (disposed || !path) return;
    void catalog.recordPath(path).catch(() => undefined);
  };

  const stopPathWatch = watch(browser.path, (path) => {
    if (initialRecorded) recordPath(path);
  });

  const ensureLoaded = async (): Promise<void> => {
    if (!browser.loaded.value) {
      let target = initialPath;
      try {
        target = (await channel.realpath(initialPath)).path;
      } catch {
        target = initialPath.startsWith('/') ? initialPath : '/';
      }
      await browser.load(target);
    }
    if (!browser.error.value && !initialRecorded) {
      initialRecorded = true;
      recordPath(browser.path.value);
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopPathWatch();
    browser.dispose();
  };

  return { browser, ensureLoaded, dispose };
}
