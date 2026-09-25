import { disposeWorkspaceRuntimes } from '@/runtimes/workspace/public';

export async function disposeWorkspaceRuntime(): Promise<void> {
  try {
    await disposeWorkspaceRuntimes();
  } catch {
    // Logout/auth transitions must continue even if a stale runtime chunk cannot load.
  }
}
